import os
import csv
import tempfile
from flask import Flask, render_template, request, redirect, url_for, request, jsonify, send_file
from flask_cors import CORS
import requests


app = Flask(__name__)

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

def lookup_card_at_store(card_name, store):
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
                    "price": item.get("lowestPrice"),
                    "store": store["storeName"]
                })
            return results
        except Exception:
            return []
    # Try base, Extended Art, Borderless
    all_results = []
    for variant in [card_name, f"{card_name} (Extended Art)", f"{card_name} (Borderless)", f"{card_name} (Showcase)", f"{card_name} (Full Art)"]:
        all_results.extend(fetch_results(variant))
    return all_results
    
@app.route('/lookup', methods=['POST'])
def lookup():
    data = request.get_json()
    card_name = data.get("cardName")
    if not card_name:
        return jsonify({"error": "Missing cardName in request body"}), 400
    for store in STORES:
        results = lookup_card_at_store(card_name, store)
        if results:
            return jsonify(results)
    return jsonify([])

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
    clean_names = [line.split(' ', 1)[1] if line.split(' ', 1)[0].isdigit() else line for line in card_names]
    limited_names = clean_names[:50]
    results_by_store = {store['storeName']: [] for store in STORES}
    all_results = []
    for name in limited_names:
        for store in STORES:
            store_results = lookup_card_at_store(name, store)
            if store_results:
                results_by_store[store['storeName']].extend(store_results)
                all_results.extend(store_results)
                break
    # Always render results page, never send CSV
    return render_template('import_results.html', results_by_store=results_by_store, all_results=all_results, card_names=limited_names)

@app.route('/')
def index():
    return render_template('index.html')

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
