"""Shared battlefield token state with atomic actions across controllers."""
from contextlib import closing
import json
import os
import sqlite3

from flask import Blueprint, abort, jsonify, render_template, request

tokens = Blueprint("tokens", __name__)


@tokens.get("/tokens")
@tokens.get("/obs/tokens")
def page():
    return render_template("tokens.html", control=request.path == "/tokens")


def number(data, key, default=1):
    value = data.get(key, default)
    if type(value) is not int or not 0 <= value <= 1000000:
        abort(400)
    return value


@tokens.route("/tokens/state", methods=["GET", "POST"])
def state():
    if request.method == "POST" and request.headers.get("Sec-Fetch-Site") == "cross-site":
        abort(403)
    path = os.environ.get("TOKEN_DB", "/data/tokens.sqlite")
    with closing(sqlite3.connect(path, timeout=30)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS battlefield (id INTEGER PRIMARY KEY, state TEXT NOT NULL)")
        if not db.in_transaction:
            db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT state FROM battlefield WHERE id=1").fetchone()
        frame = json.loads(row[0]) if row else {"groups": [], "history": []}
        groups = frame["groups"]
        if request.method == "POST":
            data = request.get_json()
            if not isinstance(data, dict):
                abort(400)
            action = data.get("action")
            previous = json.loads(json.dumps(groups))
            quantity = number(data, "quantity")
            if action == "undo":
                if frame["history"]:
                    groups = frame["history"].pop()
            elif action == "create":
                counters = number(data, "counters", 0)
                groups.append({"quantity": quantity, "counters": counters, "tapped": False, "sick": True})
                if data.get("crusade"):
                    for group in groups:
                        group["counters"] += quantity
            elif action in {"all_counters", "next_turn", "clear"}:
                if action == "clear":
                    groups = []
                for group in groups:
                    if action == "all_counters":
                        group["counters"] += quantity
                    elif action == "next_turn":
                        group.update(tapped=False, sick=False)
            elif action == "group_action":
                counters = number(data, "counters", 0)
                operation = data.get("operation")
                target = data.get("target")
                all_tokens = data.get("all") is True
                if operation not in {"tap", "untap", "kill", "counter"} or target not in {"ready", "sick", "untapped", "tapped", "all"}:
                    abort(400)
                selected_any = False
                remaining = []
                changed = []
                for group in groups:
                    eligible = group["counters"] == counters
                    if operation == "tap":
                        eligible = eligible and not group["tapped"]
                    elif operation == "untap":
                        eligible = eligible and group["tapped"]
                    if target == "ready":
                        eligible = eligible and not group["sick"]
                    elif target == "sick":
                        eligible = eligible and group["sick"]
                        if operation == "counter":
                            eligible = eligible and not group["tapped"]
                    elif target == "untapped":
                        eligible = eligible and not group["tapped"] and not group["sick"]
                    elif target == "tapped":
                        eligible = eligible and group["tapped"]
                    if eligible and (all_tokens or not selected_any):
                        selected_any = True
                        count = group["quantity"] if all_tokens else 1
                        selected = dict(group, quantity=count)
                        if group["quantity"] > count:
                            remaining.append(dict(group, quantity=group["quantity"] - count))
                        if operation == "tap":
                            selected["tapped"] = True
                        elif operation == "untap":
                            selected["tapped"] = False
                        elif operation == "counter":
                            selected["counters"] += 1
                        if operation != "kill":
                            changed.append(selected)
                    else:
                        remaining.append(group)
                if not selected_any:
                    abort(409)
                groups = remaining + changed
            elif action in {"tap", "untap", "ready", "sick", "counter_up", "counter_down", "remove"}:
                index = number(data, "index", 0)
                if index >= len(groups):
                    abort(409)
                group = groups[index]
                # Reject edits based on a stale controller's group.
                if data.get("group") != group:
                    abort(409)
                if quantity == 0 or quantity > group["quantity"]:
                    abort(400)
                selected = dict(group, quantity=quantity)
                group["quantity"] -= quantity
                if action in {"tap", "untap"}:
                    selected["tapped"] = action == "tap"
                elif action in {"ready", "sick"}:
                    selected["sick"] = action == "sick"
                elif action == "counter_up":
                    selected["counters"] += 1
                elif action == "counter_down":
                    selected["counters"] = max(0, selected["counters"] - 1)
                if action != "remove":
                    groups.append(selected)
            else:
                abort(400)
            merged = {}
            for group in groups:
                if not group["quantity"]:
                    continue
                key = (group["counters"], group["tapped"], group["sick"])
                if key not in merged:
                    merged[key] = dict(group)
                else:
                    merged[key]["quantity"] += group["quantity"]
            groups = sorted(merged.values(), key=lambda g: (g["counters"], g["tapped"], g["sick"]))
            if action != "undo":
                frame["history"] = (frame["history"] + [previous])[-20:]
            frame["groups"] = groups
            db.execute("INSERT OR REPLACE INTO battlefield VALUES(1, ?)", (json.dumps(frame),))
        response = jsonify(groups=groups, can_undo=bool(frame["history"]))
        response.cache_control.no_store = True
        return response
