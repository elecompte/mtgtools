"""Shared battlefield token state with atomic actions across controllers."""
from contextlib import closing
import json
import os
import secrets
import sqlite3

from flask import Blueprint, abort, jsonify, render_template, request

tokens = Blueprint("tokens", __name__)
TOKEN_TYPES = {
    "statue": {"name": "Statue", "plural": "Statues", "image": "/static/img/tiki-statues.png", "base": 1},
    "gnome": {"name": "Gnome", "plural": "Gnomes", "image": "/static/img/gnomes.png?v=cartoon-2", "base": 1},
    "servo": {"name": "Servo", "plural": "Servos", "image": "/static/img/servos.png", "base": 1},
    "toy": {"name": "Toy", "plural": "Toys", "image": "/static/img/toys.png", "base": 1, "variants": 9, "columns": 3, "rows": 3},
    "thopter": {"name": "Thopter", "plural": "Thopters", "image": "/static/img/thopters.png", "base": 1},
}


def artwork_key(group):
    return (group.get("type", "statue"), group["counters"])


def assign_artwork(groups, previous=None):
    """Keep resident/moving group artwork; give newly split groups a fresh choice."""
    cohorts = {}
    for group in groups:
        if group["quantity"]:
            cohorts.setdefault(artwork_key(group), []).append(group)
    resident_sources = {key for key, members in cohorts.items()
                        if any(g.get("_art_source") == key for g in members)}
    chosen = {}
    for key, members in cohorts.items():
        if previous is None:
            candidates = members
        else:
            residents = [g for g in members if g.get("_art_source") == key]
            moving = [g for g in members if g.get("_art_source") is not None
                      and g["_art_source"] not in resident_sources]
            candidates = residents or moving
        for candidate in candidates:
            if type(candidate.get("variant")) is int and 0 <= candidate["variant"] < TOKEN_TYPES[key[0]].get("variants", 8):
                chosen[key] = candidate["variant"]
                break
    for key in cohorts:
        if key in chosen:
            continue
        kind = key[0]
        used = {variant for other, variant in chosen.items() if other[0] == kind}
        initial_statue = kind == "statue" and not used and not any(
            artwork_key(group)[0] == kind for group in (previous or []))
        count = TOKEN_TYPES[kind].get("variants", 8)
        choices = [variant for variant in range(count) if variant not in used] or list(range(count))
        chosen[key] = 3 if initial_statue else secrets.choice(choices)
    for group in groups:
        group.pop("_art_source", None)
        if group["quantity"]:
            group["variant"] = chosen[artwork_key(group)]


def selected_types(data):
    kinds = data.get("types", ["statue"])
    if not isinstance(kinds, list) or not kinds or any(not isinstance(kind, str) or kind not in TOKEN_TYPES for kind in kinds):
        abort(400)
    return list(dict.fromkeys(kinds))



@tokens.get("/tokens")
@tokens.get("/obs/tokens")
def page():
    return render_template("tokens.html", control=request.path == "/tokens", token_types=TOKEN_TYPES)


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
        buffs = frame.get("buffs", [])
        # Migrate older battlefield state once, under the same SQLite transaction.
        before_artwork = json.dumps(groups)
        assign_artwork(groups)
        artwork_migrated = before_artwork != json.dumps(groups)
        if request.method == "POST":
            data = request.get_json()
            if not isinstance(data, dict):
                abort(400)
            action = data.get("action")
            previous = json.loads(json.dumps(groups))
            previous_buffs = json.loads(json.dumps(buffs))
            quantity = number(data, "quantity")
            if action != "undo":
                for group in groups:
                    group["_art_source"] = artwork_key(group)
            if action == "undo":
                if frame["history"]:
                    snapshot = frame["history"].pop()
                    if isinstance(snapshot, list):
                        groups, buffs = snapshot, []
                    else:
                        groups, buffs = snapshot["groups"], snapshot.get("buffs", [])
            elif action == "add_buff":
                kinds = selected_types(data)
                toughness = data.get("toughness")
                if type(toughness) is not int or toughness not in (0, 1):
                    abort(400)
                buffs.append({"id": secrets.token_hex(12), "types": kinds, "power": 1, "toughness": toughness})
            elif action == "remove_buff":
                buff_id = data.get("id")
                if not isinstance(buff_id, str):
                    abort(400)
                remaining = [buff for buff in buffs if buff["id"] != buff_id]
                if len(remaining) == len(buffs):
                    abort(409)
                buffs = remaining
            elif action == "create":
                counters = number(data, "counters", 0)
                kinds = selected_types(data)
                if quantity < 1:
                    abort(400)
                tapped = data.get("tapped", False)
                if type(tapped) is not bool:
                    abort(400)
                for kind in kinds:
                    groups.append({"type": kind, "quantity": quantity, "counters": counters, "tapped": tapped, "sick": True})
                if data.get("crusade"):
                    for group in groups:
                        group["counters"] += quantity * len(kinds)
            elif action in {"all_counters", "next_turn", "clear"}:
                if action == "clear":
                    groups = []
                for group in groups:
                    if action == "all_counters":
                        group["counters"] += quantity
                    elif action == "next_turn":
                        group.update(tapped=False, sick=False)
            elif action == "bulk_action":
                operation = data.get("operation")
                statuses = data.get("statuses")
                types = data.get("types")
                if (operation not in {"tap", "untap", "kill", "counter"}
                        or not isinstance(statuses, list) or not isinstance(types, list)
                        or any(status not in ("tapped", "untapped") for status in statuses)
                        or any(not isinstance(kind, str) or kind not in TOKEN_TYPES for kind in types)):
                    abort(400)
                changed = False
                remaining = []
                for group in groups:
                    status = "tapped" if group["tapped"] else "untapped"
                    eligible = group.get("type", "statue") in types and status in statuses
                    if operation == "tap":
                        eligible = eligible and not group["tapped"]
                    elif operation == "untap":
                        eligible = eligible and group["tapped"]
                    if eligible:
                        changed = True
                        if operation == "kill":
                            continue
                        if operation == "counter":
                            group["counters"] += 1
                        else:
                            group["tapped"] = operation == "tap"
                    remaining.append(group)
                if not changed:
                    abort(409)
                groups = remaining
            elif action == "group_action":
                counters = number(data, "counters", 0)
                operation = data.get("operation")
                target = data.get("target")
                kind = data.get("type", "statue")
                if not isinstance(kind, str) or kind not in TOKEN_TYPES:
                    abort(400)
                all_tokens = data.get("all") is True
                if operation not in {"tap", "untap", "kill", "counter"} or target not in {"ready", "sick", "untapped", "tapped", "all"}:
                    abort(400)
                selected_any = False
                remaining = []
                changed = []
                for group in groups:
                    eligible = group["counters"] == counters and group.get("type", "statue") == kind
                    if operation == "tap":
                        eligible = eligible and not group["tapped"]
                    elif operation == "untap":
                        eligible = eligible and group["tapped"]
                    if target == "ready":
                        eligible = eligible and not group["sick"]
                    elif target == "sick":
                        eligible = eligible and group["sick"]
                        if operation in {"counter", "kill"}:
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
                if data.get("group") != {key: value for key, value in group.items() if key != "_art_source"}:
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
            assign_artwork(groups, None if action == "undo" else previous)
            merged = {}
            for group in groups:
                if not group["quantity"]:
                    continue
                key = (group.get("type", "statue"), group["counters"], group["tapped"], group["sick"])
                if key not in merged:
                    merged[key] = dict(group, type=key[0])
                else:
                    merged[key]["quantity"] += group["quantity"]
            groups = sorted(merged.values(), key=lambda g: (g.get("type", "statue"), g["counters"], g["tapped"], g["sick"]))
            if action != "undo":
                frame["history"] = (frame["history"] + [{"groups": previous, "buffs": previous_buffs}])[-20:]
            frame["groups"] = groups
            frame["buffs"] = buffs
            db.execute("INSERT OR REPLACE INTO battlefield VALUES(1, ?)", (json.dumps(frame),))
        elif artwork_migrated:
            db.execute("INSERT OR REPLACE INTO battlefield VALUES(1, ?)", (json.dumps(frame),))
        response = jsonify(groups=groups, buffs=buffs, can_undo=bool(frame["history"]))
        response.cache_control.no_store = True
        return response
