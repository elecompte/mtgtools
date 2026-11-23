"""Persistent inventory watches and six-hour inventory polling."""
import json
import hashlib
import io
from urllib.parse import urlsplit
import logging
import os
import sqlite3
import time
import uuid
from flask import Blueprint, redirect, render_template, request, jsonify, send_file, url_for, abort

watchlist = Blueprint("watchlist", __name__)


def connect():
    db = sqlite3.connect(os.environ.get("WATCHLIST_DB", "/data/watchlist.sqlite"), timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS watches (name TEXT PRIMARY KEY COLLATE NOCASE, checked TEXT, results TEXT DEFAULT '[]', error TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS watch_checks (name TEXT PRIMARY KEY COLLATE NOCASE, request_id TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS card_media (id TEXT PRIMARY KEY, url TEXT NOT NULL, data BLOB, mime TEXT)")
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
    import re
    name = request.args.get("name", "").strip()
    set_name = request.args.get("set", "").strip()
    product_id = request.args.get("product_id", "")
    if not name or len(name) > 200 or len(set_name) > 200:
        return jsonify(error="A valid card name and set are required."), 400

    def fetch(url, params=None):
        response = requests.get(url, params=params, headers=SCRYFALL_HEADERS, timeout=10)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    try:
        card = None
        if product_id.isdigit():
            candidate = fetch("https://api.scryfall.com/cards/tcgplayer/" + product_id)
            if candidate:
                card = candidate
        if card is None and set_name:
            # Set-qualified lookup supports older saved listings without product IDs.
            base_name = re.sub(r"\s*\([^)]*\)\s*$", "", name)
            quote = lambda value: value.replace("\\", "\\\\").replace('"', '\\"')
            data = fetch("https://api.scryfall.com/cards/search", {
                "q": '!"' + quote(base_name) + '" set:"' + quote(set_name) + '"',
                "unique": "prints",
            })
            candidates = (data or {}).get("data", [])
            if len(candidates) == 1 and not data.get("has_more"):
                card = candidates[0]
        if card is None:
            return jsonify(error="The exact printing could not be identified. View the store listing for its image."), 404
        faces = card.get("card_faces") or [card]
        unique_faces = list(dict.fromkeys(
            (face.get("name", ""), face.get("oracle_text", "")) for face in faces
        ))
        face_text = unique_faces[0][1] if len(unique_faces) == 1 else "\n\n".join(
            name + "\n" + text for name, text in unique_faces
        )
        return jsonify(
            oracle_text=card.get("oracle_text") or face_text,
            image=media_url((card.get("image_uris") or faces[0].get("image_uris") or {}).get("normal")),
            image_set=card.get("set_name"),
        )
    except (requests.RequestException, ValueError, KeyError):
        return jsonify(error="Card details could not be loaded. Try again shortly."), 502


@watchlist.get("/watchlist/symbols")
def card_symbols():
    from app import requests, SCRYFALL_HEADERS
    try:
        response = requests.get("https://api.scryfall.com/symbology", headers=SCRYFALL_HEADERS, timeout=10)
        response.raise_for_status()
        symbols = {item["symbol"]: {"url": media_url(item["svg_uri"]), "label": item["english"]}
                   for item in response.json()["data"]}
        result = jsonify(symbols)
        result.cache_control.no_store = True
        return result
    except (requests.RequestException, ValueError, KeyError):
        return jsonify(error="Symbols unavailable"), 502



def media_url(source):
    if not source:
        return None
    parsed = urlsplit(source)
    if parsed.scheme != "https" or parsed.hostname not in {"cards.scryfall.io", "svgs.scryfall.io"}:
        raise ValueError("Unexpected card media host")
    key = hashlib.sha256(source.encode()).hexdigest()
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO card_media(id, url) VALUES (?, ?)", (key, source))
    return url_for("watchlist.cached_media", key=key)


@watchlist.get("/watchlist/media/<key>")
def cached_media(key):
    from app import requests, SCRYFALL_HEADERS
    with connect() as db:
        item = db.execute("SELECT * FROM card_media WHERE id=?", (key,)).fetchone()
    if item is None:
        abort(404)
    data, mime = item["data"], item["mime"]
    if data is None:
        try:
            with requests.get(item["url"], headers=SCRYFALL_HEADERS, timeout=15,
                              stream=True, allow_redirects=False) as response:
                response.raise_for_status()
                mime = response.headers.get("Content-Type", "").split(";")[0].strip()
                if mime not in {"image/jpeg", "image/png", "image/webp", "image/svg+xml"}:
                    raise ValueError("Unexpected image format")
                chunks = []
                size = 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 10 * 1024 * 1024:
                        raise ValueError("Image too large")
                    chunks.append(chunk)
                data = b"".join(chunks)
                if not data:
                    raise ValueError("Empty image")
            with connect() as db:
                db.execute("UPDATE card_media SET data=?, mime=? WHERE id=?", (data, mime, key))
        except (requests.RequestException, ValueError):
            return jsonify(error="Card image could not be loaded. Try again shortly."), 502
    result = send_file(io.BytesIO(data), mimetype=mime, etag=key,
                       conditional=True, max_age=86400)
    result.headers["X-Content-Type-Options"] = "nosniff"
    return result
