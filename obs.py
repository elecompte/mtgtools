"""Store the most recent frame for the shared OBS display."""
import json
import os
import sqlite3
import tempfile

from flask import Blueprint, abort, jsonify, render_template, request

obs = Blueprint("obs", __name__)
CARDS = {"valet": "Devilish Valet", "krenko": "Krenko", "animpakal": "Anim Pakal",
         "scuteswarm": "Scute Swarm", "mana": "Floating mana"}


@obs.get("/obs")
@obs.get("/obs/control")
def obs_page():
    if request.path == "/obs":
        return render_template("obs_display.html")
    return render_template("obs.html", control=True, cards=CARDS)


@obs.route("/obs/state", methods=["GET", "PUT"])
def obs_state():
    if request.method == "PUT":
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            abort(403)
        if not request.content_length or request.content_length > 8192:
            abort(413)
        frame = request.get_json()
        if not isinstance(frame, dict) or frame.get("card") not in tuple(CARDS) or not isinstance(frame.get("values"), dict):
            abort(400)
    db = sqlite3.connect(os.path.join(tempfile.gettempdir(), "mtgtools-obs.sqlite"))
    try:
        with db:
            db.execute("CREATE TABLE IF NOT EXISTS displays (id TEXT PRIMARY KEY, frame TEXT NOT NULL)")
            if request.method == "PUT":
                db.execute("INSERT OR REPLACE INTO displays VALUES (?, ?)", ("shared", json.dumps(frame)))
                return "", 204
            # Use the last legacy display until the shared controller first writes.
            row = db.execute(
                "SELECT frame FROM displays ORDER BY (id = 'shared') DESC, rowid DESC LIMIT 1"
            ).fetchone()
            response = jsonify(json.loads(row[0]) if row else {"card": "valet", "values": {}})
            response.cache_control.no_store = True
            return response
    finally:
        db.close()
