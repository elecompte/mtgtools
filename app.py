import os
import csv
import tempfile
import threading
import uuid
import re
from flask import Flask, render_template, request, redirect, url_for, request, jsonify, send_file
from flask_cors import CORS
import requests


app = Flask(__name__)
from watchlist import watchlist
app.register_blueprint(watchlist)
from obs import obs
app.register_blueprint(obs)

STORES = [
    {
        "storeName": "Salisbury",
        "api": "https://portalsgamessby.tcgplayerpro.com/api/catalog/search",
        "baseUrl": "https://portalsgamessby.tcgplayerpro.com",
    },
    {
        "storeName": "Easton",
        "api": "https://portalsgames.tcgplayerpro.com/api/catalog/search",
        "baseUrl": "https://portalsgames.tcgplayerpro.com",
    },
    {
        "storeName": "Kent Island",
        "api": "https://portalsgameski.tcgplayerpro.com/api/catalog/search",
        "baseUrl": "https://portalsgameski.tcgplayerpro.com",
    },
]

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": "",  # will be set per store
    "priority": "u=1, i",
    "sec-ch-ua": '"Microsoft Edge";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
    "Cookie": "optimizelyId=2b184282-e6c6-41c0-85ef-3be5941512a1; tracking-preferences={%22version%22:1%2C%22destinations%22:{%22Actions%20Amplitude%22:true}%2C%22custom%22:{%22advertising%22:true%2C%22functional%22:true%2C%22marketingAndAnalytics%22:true}}; .AspNetCore.Session=CfDJ8ALidwpDTQpJquazmcIKysAsQ%2Fhxc%2Ff%2BB21qpn7uA%2FLHmlzWinwg7rjR31nQVQjA7y2Bd%2B6bM4hJrBpI0ypWv0X1PTIsX3dQ2aeDka28i7WxaChEtde9H5yRpJcRo8Ydp74nRU7u65GQKAB09EGnfPOcwft4VI4R6Sc9q1elnJYd"
}

SCRYFALL_HEADERS = {
    # Scryfall asks API clients not to use their HTTP library's default headers.
    "User-Agent": os.environ.get(
        "SCRYFALL_USER_AGENT",
        "mtgtools/1.0 (https://github.com/elecompte/mtgtools)",
    ),
    "Accept": "application/json;q=0.9,*/*;q=0.8",
}

JOB_LOCK = threading.Lock()
IMPORT_JOBS = {}

def resolve_card_name(card_name: str):
    """Use Scryfall fuzzy search to find the best match for a card name."""
    try:
        r = requests.get(
            "https://api.scryfall.com/cards/named",
            params={"fuzzy": card_name},
            headers=SCRYFALL_HEADERS,
            timeout=8,
        )
        if r.status_code == 200:
            return r.json().get("name")
    except Exception:
        pass
    return None

def lookup_card_at_store(card_name, store, strict=False):
    headers = HEADERS.copy()
    headers["origin"] = store["baseUrl"]
    headers["referer"] = f'{store["baseUrl"]}/search/products?productName={card_name}&productLineName=Magic:+The+Gathering'
    def fetch_results(name):
        payload = {
            "context": {"productLineName": "Magic: The Gathering"},
            "filters": {"productName": [name]},
            "from": 0,
            "size": 24,
            "sort": [{"field": "in-stock-price-sort", "order": "desc"}]
        }
        try:
            resp = requests.post(store["api"], headers=headers, json=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            products = data.get("products", {}).get("items", [])
            results = []
            for item in products:
                results.append({
                    "name": item.get("name"),
                    "url": f'{store["baseUrl"]}/catalog/magic/{item.get("setUrlName")}/{item.get("productUrlName")}/{item.get("id")}',
                    "inStock": item.get("quantity") or item.get("availableQuantity"),
                    "set": item.get("setName"),
                    "price": item.get("lowestPrice"),
                    "store": store["storeName"]
                })
            return results
        except Exception:
            if strict:
                raise
            return []
    # Try base, Extended Art, Borderless
    all_results = []
    for variant in [card_name, f"{card_name} (Extended Art)", f"{card_name} (Borderless)", f"{card_name} (Showcase)", f"{card_name} (Full Art)"]:
        all_results.extend(fetch_results(variant))
    return all_results

def normalize_set_name(value):
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.lower())

def set_name_matches(store_set, target_set):
    if not target_set:
        return True
    if not store_set:
        return False
    store_norm = normalize_set_name(store_set)
    target_norm = normalize_set_name(target_set)
    return store_norm in target_norm or target_norm in store_norm

def normalize_card_entries(card_entries):
    cleaned = []
    for entry in card_entries:
        if isinstance(entry, dict):
            name = str(entry.get("name") or "").strip()
            set_name = entry.get("set")
            exact = bool(entry.get("exact"))
        else:
            name = str(entry or "").strip()
            set_name = None
            exact = False
        if not name:
            continue
        parts = name.split(' ', 1)
        if parts[0].isdigit() and len(parts) > 1:
            name = parts[1].strip()
        cleaned.append({"name": name, "set": set_name, "exact": exact})
    return cleaned

def run_import_job(job_id, limited_entries):
    results_by_store = {store['storeName']: [] for store in STORES}
    all_results = []
    unavailable = []
    current = 0
    for entry in limited_entries:
        name = entry["name"]
        set_name = entry.get("set")
        exact = entry.get("exact", False)
        corrected = None
        for store in STORES:
            store_results = lookup_card_at_store(name, store)
            if not store_results:
                if corrected is None and not exact:
                    corrected = resolve_card_name(name)
                if corrected and corrected.lower() != name.lower():
                    store_results = lookup_card_at_store(corrected, store)
            store_results = [r for r in store_results if float(r.get("inStock") or 0) > 0]
            if store_results and set_name:
                store_results = [
                    result for result in store_results
                    if set_name_matches(result.get("set"), set_name)
                ]
            if store_results:
                results_by_store[store['storeName']].extend(store_results)
                all_results.extend(store_results)
                break
        else:
            unavailable.append(name)
        current += 1
        with JOB_LOCK:
            job = IMPORT_JOBS.get(job_id)
            if job:
                job["current"] = current
    with JOB_LOCK:
        job = IMPORT_JOBS.get(job_id)
        if job:
            job["unavailable"] = unavailable
            job["status"] = "done"
            job["results_by_store"] = results_by_store
            job["all_results"] = all_results
            job["card_names"] = [entry["name"] for entry in limited_entries]

def create_import_job(card_entries):
    cleaned = normalize_card_entries(card_entries)
    limited_entries = cleaned[:50]
    job_id = uuid.uuid4().hex
    with JOB_LOCK:
        IMPORT_JOBS[job_id] = {
            "status": "running",
            "current": 0,
            "total": len(limited_entries),
        }
    thread = threading.Thread(target=run_import_job, args=(job_id, limited_entries), daemon=True)
    thread.start()
    return job_id, len(limited_entries)
    
@app.route('/lookup', methods=['POST'])
def lookup():
    data = request.get_json()
    card_name = data.get("cardName")
    if not card_name:
        return jsonify({"error": "Missing cardName in request body"}), 400

    def search_all(name):
        for store in STORES:
            results = lookup_card_at_store(name, store)
            if results:
                return results
        return []

    results = search_all(card_name)
    if not results:
        corrected = resolve_card_name(card_name)
        if corrected and corrected.lower() != card_name.lower():
            results = search_all(corrected)

    return jsonify(results)

@app.route('/scryfall_search', methods=['POST'])
def scryfall_search():
    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "Missing query in request body"}), 400
    try:
        resp = requests.get(
            "https://api.scryfall.com/cards/search",
            params={"q": query, "unique": "cards", "order": "name"},
            headers=SCRYFALL_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()
    except (requests.RequestException, ValueError):
        app.logger.exception("Scryfall search request failed")
        return jsonify({"error": "Scryfall request failed"}), 502

    results = []
    for card in payload.get("data", []):
        results.append({
            "name": card.get("name"),
            "set": card.get("set_name"),
            "collector": card.get("collector_number"),
            "uri": card.get("scryfall_uri"),
        })
    return jsonify({"results": results, "has_more": payload.get("has_more", False)})

@app.route('/scryfall_batch', methods=['POST'])
def scryfall_batch():
    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    cursor = data.get("cursor") or {}
    if not query:
        return jsonify({"error": "Missing query in request body"}), 400

    try:
        page = max(1, int(cursor.get("page") or 1))
        index = max(0, int(cursor.get("index") or 0))
        sent = max(0, int(cursor.get("sent") or 0))
    except (AttributeError, TypeError, ValueError):
        return jsonify({"error": "Invalid Scryfall search cursor"}), 400
    entries = []
    last_payload = None
    last_page = page
    last_index = index
    total_cards = None

    while len(entries) < 50:
        try:
            resp = requests.get(
                "https://api.scryfall.com/cards/search",
                params={"q": query, "unique": "cards", "order": "name", "page": page},
                headers=SCRYFALL_HEADERS,
                timeout=10,
            )
            resp.raise_for_status()
            payload = resp.json()
        except (requests.RequestException, ValueError):
            app.logger.exception("Scryfall batch request failed")
            return jsonify({"error": "Scryfall request failed"}), 502

        last_payload = payload
        total_cards = payload.get("total_cards")
        cards = payload.get("data", [])
        if index >= len(cards) and not payload.get("has_more"):
            break

        while index < len(cards) and len(entries) < 50:
            card = cards[index]
            entries.append({
                "name": card.get("name"),
                "set": card.get("set_name"),
            })
            index += 1

        last_page = page
        last_index = index

        if len(entries) >= 50:
            break
        if payload.get("has_more"):
            page += 1
            index = 0
            continue
        break

    next_cursor = None
    next_count = 0
    if last_payload:
        cards = last_payload.get("data", [])
        has_more = last_payload.get("has_more", False)
        remaining_in_page = max(0, len(cards) - last_index)
        sent_now = sent + len(entries)
        if total_cards is not None and sent_now < total_cards:
            next_count = min(50, total_cards - sent_now)
            if remaining_in_page > 0:
                next_cursor = {"page": last_page, "index": last_index, "sent": sent_now}
            elif has_more:
                next_cursor = {"page": last_page + 1, "index": 0, "sent": sent_now}

    return jsonify({
        "entries": entries,
        "next_cursor": next_cursor,
        "next_count": next_count,
        "total_cards": total_cards,
    })

@app.route('/import_job', methods=['POST'])
def import_job():
    data = request.get_json(silent=True) or {}
    card_entries = data.get("cardNames") or []
    scryfall_meta = data.get("scryfall") or None
    if not isinstance(card_entries, list) or not card_entries:
        return jsonify({"error": "Missing cardNames"}), 400
    job_id, total = create_import_job(card_entries)
    if scryfall_meta:
        with JOB_LOCK:
            job = IMPORT_JOBS.get(job_id)
            if job is not None:
                job["scryfall_meta"] = scryfall_meta
    return jsonify({"job_id": job_id, "total": total})

@app.route('/import_job/<job_id>/progress', methods=['GET'])
def import_job_progress(job_id):
    with JOB_LOCK:
        job = IMPORT_JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify({
            "status": job["status"],
            "current": job["current"],
            "total": job["total"],
        })

@app.route('/import_job/<job_id>/results', methods=['GET'])
def import_job_results(job_id):
    with JOB_LOCK:
        job = IMPORT_JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        if job["status"] != "done":
            return jsonify({"error": "Job not complete"}), 400
        results_by_store = job.get("results_by_store", {})
        all_results = job.get("all_results", [])
        card_names = job.get("card_names", [])
        scryfall_meta = job.get("scryfall_meta")
    return render_template(
        'import_results.html',
        results_by_store=results_by_store,
        all_results=all_results,
        card_names=card_names,
        scryfall_meta=scryfall_meta,
        unavailable=job.get("unavailable", []),
    )

@app.route('/import', methods=['GET', 'POST'])
def import_cards():
    if request.method == 'GET':
        return render_template('import.html')
    # Accept file upload or textarea
    file = request.files.get('file')
    card_names = []
    # If user POSTs cardNames (from export form), use that
    if not file and request.form.get('cardNames'):
        content = request.form['cardNames']
        card_names = [line.strip() for line in content.splitlines() if line.strip()]
    elif file:
        content = file.read().decode('utf-8')
        card_names = [line.strip() for line in content.splitlines() if line.strip()]
    else:
        return render_template('import.html', error="No file uploaded")
    limited_names = [entry["name"] for entry in normalize_card_entries(card_names)][:50]
    results_by_store = {store['storeName']: [] for store in STORES}
    all_results = []
    for name in limited_names:
        corrected = None
        for store in STORES:
            store_results = lookup_card_at_store(name, store)
            if not store_results:
                if corrected is None:
                    corrected = resolve_card_name(name)
                if corrected and corrected.lower() != name.lower():
                    store_results = lookup_card_at_store(corrected, store)
            if store_results:
                results_by_store[store['storeName']].extend(store_results)
                all_results.extend(store_results)
                break
    # Always render results page, never send CSV
    return render_template('import_results.html', results_by_store=results_by_store, all_results=all_results, card_names=limited_names)

@app.get('/service-worker.js')
def service_worker():
    return app.send_static_file('js/service-worker.js')


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/mana')
def mana():
    return render_template('mana.html')

@app.route('/valet')
def valet():
    return render_template('valet.html')

@app.route('/krenko')
def krenko():
    return render_template('krenko.html')

@app.route('/animpakal')
def animpakal():
    return render_template('animpakal.html')

@app.route('/scuteswarm', methods=['GET', 'POST'])
def scuteswarm():
    final_swarms = 0
    initial = 0
    lands = 0
    doubler = 1
    if request.method == 'POST':
        try:
            initial = int(request.form['initial'])
            lands = int(request.form['lands'])
            doubler = int(request.form.get('doubler', 0))
            i = 0
            while i < lands:
                final_swarms = initial + (initial * (doubler))
                i += 1
                initial = final_swarms

        except Exception:
            final_swarms = None
    return render_template('scuteswarm.html', final_swarms=final_swarms, initial=final_swarms, lands=lands, doubler=doubler)



if __name__ == "__main__":
    app.run(debug=True)
    app.run(host='0.0.0.0')
