"""Persistent inventory watches and six-hour inventory polling."""
import json
import logging
import os
import sqlite3
import time
import uuid
from flask import Blueprint, redirect, render_template, request, jsonify

watchlist = Blueprint("watchlist", __name__)


def connect():
    db = sqlite3.connect(os.environ.get("WATCHLIST_DB", "/data/watchlist.sqlite"), timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS watches (name TEXT PRIMARY KEY COLLATE NOCASE, checked TEXT, results TEXT DEFAULT '[]', error TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS watch_checks (name TEXT PRIMARY KEY COLLATE NOCASE, request_id TEXT NOT NULL)")
    return db


@watchlist.route("/watchlist", methods=["GET", "POST"])
def page():
    with connect() as db:
        if request.method == "POST":
            if request.form.get("check_now"):
                token = uuid.uuid4().hex
                db.execute("INSERT OR IGNORE INTO watch_checks SELECT name, ? FROM watches", (token,))
            elif request.form.get("remove"):
                db.execute("DELETE FROM watch_checks WHERE name=?", (request.form["remove"],))
                db.execute("DELETE FROM watches WHERE name=?", (request.form["remove"],))
            else:
                for name in request.form.getlist("names"):
                    if name.strip():
                        db.execute("INSERT OR IGNORE INTO watches(name) VALUES (?)", (name.strip()[:200],))
            return redirect("/watchlist", code=303)
        rows = [dict(row) for row in db.execute("SELECT * FROM watches ORDER BY name")]
    for row in rows:
        row["results"] = json.loads(row["results"])
    with connect() as db:
        pending = db.execute("SELECT COUNT(*) FROM watch_checks").fetchone()[0]
    response = render_template("watchlist.html", watches=rows, pending=pending)
    return response


@watchlist.get("/watchlist/status")
def check_status():
    with connect() as db:
        pending = db.execute("SELECT COUNT(*) FROM watch_checks").fetchone()[0]
    response = jsonify(pending=pending)
    response.cache_control.no_store = True
    return response


def check():
    from app import STORES, lookup_card_at_store
    from datetime import datetime, timezone
    with connect() as db:
        names = list(db.execute("""SELECT w.name, q.request_id FROM watches w
            LEFT JOIN watch_checks q ON w.name=q.name
            WHERE q.name IS NOT NULL OR w.checked IS NULL OR w.checked < datetime('now','-6 hours')
            ORDER BY q.name IS NULL, w.name"""))
    for row in names:
        name = row["name"]
        results = []
        failures = []
        failed_stores = set()
        for store in STORES:
            try:
                listings = lookup_card_at_store(name, store, strict=True)
                for result in listings:
                    if float(result.get("inStock") or 0) > 0:
                        results.append(result)
            except Exception as exc:
                import requests
                if isinstance(exc, requests.HTTPError):
                    reason = f"HTTP {exc.response.status_code}"
                    if exc.response.status_code == 403:
                        reason += " · store API refused access"
                    elif exc.response.status_code == 429:
                        reason += " · store API rate limit"
                elif isinstance(exc, requests.Timeout):
                    reason = "request timed out"
                elif isinstance(exc, requests.ConnectionError):
                    reason = "connection failed"
                else:
                    reason = f"unexpected response ({type(exc).__name__})"
                failures.append(f"{store['storeName']}: {reason}")
                failed_stores.add(store["storeName"])
                logging.warning("Watchlist %r, %s: %s", name, store["storeName"], reason)
        error = "; ".join(failures) or None
        with connect() as db:
            old = db.execute("SELECT results FROM watches WHERE name=?", (name,)).fetchone()
            if old and failed_stores:
                results.extend(
                    item for item in json.loads(old["results"])
                    if item.get("store") in failed_stores
                )
            if not failed_stores:
                db.execute("UPDATE watches SET checked=?, results=?, error=NULL WHERE name=?",
                           (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), json.dumps(results), name))
            else:
                db.execute("UPDATE watches SET results=?, error=? WHERE name=?",
                           (json.dumps(results), error, name))
            if row["request_id"]:
                db.execute("DELETE FROM watch_checks WHERE name=? AND request_id=?", (name, row["request_id"]))
        time.sleep(1)


if __name__ == "__main__":
    next_scheduled = 0
    while True:
        try:
            with connect() as db:
                pending = db.execute("SELECT COUNT(*) FROM watch_checks").fetchone()[0]
            if pending or time.monotonic() >= next_scheduled:
                check()
                next_scheduled = time.monotonic() + 300
        except Exception:
            import logging
            logging.exception("Watchlist check failed")
        time.sleep(2)


@watchlist.get("/watchlist/card")
def card_details():
    from app import requests, SCRYFALL_HEADERS
    name = request.args.get("name", "").strip()
    if not name or len(name) > 200:
        return jsonify(error="A card name is required."), 400
    try:
        response = requests.get(
            "https://api.scryfall.com/cards/named",
            params={"exact": name},
            headers=SCRYFALL_HEADERS,
            timeout=10,
        )
        response.raise_for_status()
        card = response.json()
        faces = card.get("card_faces") or [card]
        return jsonify(
            oracle_text=card.get("oracle_text") or "\n\n".join(
                face.get("name", "") + "\n" + face.get("oracle_text", "") for face in faces
            ),
            image=(card.get("image_uris") or faces[0].get("image_uris") or {}).get("normal"),
            image_set=card.get("set_name"),
        )
    except (requests.RequestException, ValueError, KeyError):
        return jsonify(error="Card details could not be loaded. Try again shortly."), 502
