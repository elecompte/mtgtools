"""Persistent inventory watches and six-hour inventory polling."""
import json
import os
import sqlite3
import time
from flask import Blueprint, redirect, render_template, request

watchlist = Blueprint("watchlist", __name__)


def connect():
    db = sqlite3.connect(os.environ.get("WATCHLIST_DB", "/data/watchlist.sqlite"), timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS watches (name TEXT PRIMARY KEY COLLATE NOCASE, checked TEXT, results TEXT DEFAULT '[]', error TEXT)")
    return db


@watchlist.route("/watchlist", methods=["GET", "POST"])
def page():
    with connect() as db:
        if request.method == "POST":
            if request.form.get("remove"):
                db.execute("DELETE FROM watches WHERE name=?", (request.form["remove"],))
            else:
                for name in request.form.getlist("names"):
                    if name.strip():
                        db.execute("INSERT OR IGNORE INTO watches(name) VALUES (?)", (name.strip()[:200],))
            return redirect("/watchlist", code=303)
        rows = [dict(row) for row in db.execute("SELECT * FROM watches ORDER BY name")]
    for row in rows:
        row["results"] = json.loads(row["results"])
    response = render_template("watchlist.html", watches=rows)
    return response


def check():
    from app import STORES, lookup_card_at_store
    from datetime import datetime, timezone
    with connect() as db:
        names = [row["name"] for row in db.execute("SELECT name FROM watches WHERE checked IS NULL OR checked < datetime('now','-6 hours')")]
    for name in names:
        try:
            results = []
            for store in STORES:
                for result in lookup_card_at_store(name, store, strict=True):
                    if float(result.get("inStock") or 0) > 0:
                        results.append(result)
            error = None
        except Exception:
            error = "Inventory check failed. Previous availability is shown."
        with connect() as db:
            if error:
                db.execute("UPDATE watches SET error=? WHERE name=?", (error, name))
            else:
                db.execute("UPDATE watches SET checked=?, results=?, error=NULL WHERE name=?",
                           (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), json.dumps(results), name))
        time.sleep(1)


if __name__ == "__main__":
    while True:
        try:
            check()
        except Exception:
            import logging
            logging.exception("Watchlist check failed")
        time.sleep(300)
