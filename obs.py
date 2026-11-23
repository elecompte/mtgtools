"""Store the most recent frame for each private OBS display."""
import hashlib
import json
import os
import re
import sqlite3
import tempfile

from flask import Blueprint, abort, jsonify, render_template, request

obs = Blueprint("obs", __name__)
CARDS = {"valet": "Devilish Valet", "krenko": "Krenko", "animpakal": "Anim Pakal",
         "scuteswarm": "Scute Swarm", "mana": "Floating mana"}


@obs.get("/obs")
@obs.get("/obs/control")
def obs_page():
    return render_template("obs.html", control=request.path.endswith("/control"), cards=CARDS)


@obs.route("/obs/state/<display>", methods=["GET", "PUT"])
def obs_state(display):
    if not re.fullmatch(r"[0-9a-f]{64}", display):
        abort(404)
    if request.method == "PUT":
        key = request.headers.get("X-OBS-Key", "")
        if not re.fullmatch(r"[0-9a-f]{64}", key) or hashlib.sha256(bytes.fromhex(key)).hexdigest() != display:
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
                db.execute("INSERT OR REPLACE INTO displays VALUES (?, ?)", (display, json.dumps(frame)))
                return "", 204
            row = db.execute("SELECT frame FROM displays WHERE id = ?", (display,)).fetchone()
            response = jsonify(json.loads(row[0]) if row else None)
            response.cache_control.no_store = True
            return response
    finally:
        db.close()


@obs.post("/obs/display-id")
def display_id():
    key = request.headers.get("X-OBS-Key", "")
    if not re.fullmatch(r"[0-9a-f]{64}", key):
        abort(400)
    return hashlib.sha256(bytes.fromhex(key)).hexdigest()
