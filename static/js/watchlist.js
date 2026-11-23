document.querySelectorAll('time[datetime]').forEach(time => {
  const date = new Date(time.dateTime);
  if (!Number.isNaN(date.getTime())) {
    time.textContent = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(date);
    time.title = time.dateTime;
  }
});
const filter = document.querySelector('#watch-filter');
if (filter) {
  const items = [...document.querySelectorAll('.watch-item')];
  const update = () => {
    let visible = 0;
    items.forEach(item => {
      item.hidden = filter.value !== 'all' && item.dataset.state !== filter.value;
      if (!item.hidden) visible += 1;
    });
    document.querySelector('#watch-count').textContent = visible + (visible === 1 ? ' card' : ' cards');
    document.querySelector('#watch-empty-filter').hidden = visible !== 0;
  };
  filter.addEventListener('change', update);
  update();
}

const progress = document.querySelector('#check-progress');
if (progress && Number(progress.dataset.pending) > 0) {
  const poll = async () => {
    try {
      const response = await fetch('/watchlist/status', {cache:'no-store'});
      if (!response.ok) throw new Error();
      const {pending} = await response.json();
      if (!pending) {
        location.reload();
        return;
      }
      progress.textContent = pending + ' card(s) remaining · results will refresh automatically';
    } catch {
      progress.textContent = 'Reconnecting to check progress…';
    }
    setTimeout(poll, 2000);
  };
  poll();
}

const dialog = document.querySelector('#match-dialog');
let detailRequest;
let selectedCard;
const detailCache = new Map();
const field = id => document.getElementById(id);
async function loadDetails(card) {
  detailRequest?.abort();
  detailRequest = new AbortController();
  const request = detailRequest;
  field('match-image').hidden = true;
  field('match-oracle').textContent = '';
  field('match-image-set').textContent = '';
  field('match-retry').hidden = true;
  field('match-status').textContent = 'Loading card details…';
  try {
    const productId = card.product_id || new URL(card.url).pathname.split('/').filter(Boolean).pop();
    const identity = JSON.stringify([card.name, card.set, productId]);
    let data = detailCache.get(identity);
    if (!data) {
      const response = await fetch('/watchlist/card?' + new URLSearchParams({name: card.name, set: card.set || '', product_id: productId || ''}), {signal: request.signal});
      data = await response.json();
      if (!response.ok) throw new Error(data.error);
      detailCache.set(identity, data);
    }
    if (request.signal.aborted) return;
    const oracle = data.oracle_text || 'No oracle text for this card.';
    renderOracle(oracle, {});
    try {
      const symbols = await getSymbols();
      if (!request.signal.aborted) renderOracle(oracle, symbols);
    } catch { /* Keep readable symbol codes if the symbol service is unavailable. */ }
    if (request.signal.aborted) return;
    if (data.image) {
      field('match-image').src = data.image;
      field('match-image').alt = card.name;
      field('match-image').hidden = false;
      field('match-image-set').textContent = 'Image printing · ' + data.image_set;
    }
    field('match-status').textContent = '';
  } catch (error) {
    if (request.signal.aborted) return;
    field('match-status').textContent = error.message || 'Could not load card details.';
    field('match-retry').hidden = false;
  }
}
document.querySelectorAll('[data-card]').forEach(button => {
  button.addEventListener('click', () => {
    const card = JSON.parse(button.dataset.card);
    selectedCard = card;
    field('match-name').textContent = card.name;
    field('match-store').textContent = 'Store · ' + card.store;
    field('match-set').textContent = 'Listing set · ' + (card.set || 'Unavailable');
    field('match-price').textContent = card.price == null ? 'Price unavailable' :
      new Intl.NumberFormat(undefined, {style:'currency', currency:'USD'}).format(Number(card.price));
    field('match-store-link').href = card.url;
    dialog.showModal();
    loadDetails(card);
  });
});
field('match-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => detailRequest?.abort());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
field('match-retry').addEventListener('click', () => loadDetails(selectedCard));
field('match-image').addEventListener('error', () => {
  field('match-image').hidden = true;
  field('match-image-set').textContent = 'Card image unavailable';
});


let symbolRequest;
function getSymbols() {
  if (!symbolRequest) {
    symbolRequest = fetch('/watchlist/symbols').then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).catch(error => { symbolRequest = null; throw error; });
  }
  return symbolRequest;
}
function renderOracle(text, symbols) {
  const oracle = field('match-oracle');
  oracle.replaceChildren();
  for (const part of text.split(/(\{[^{}]+\})/g)) {
    const symbol = symbols[part];
    if (!symbol) {
      oracle.append(document.createTextNode(part));
      continue;
    }
    const image = document.createElement('img');
    image.className = 'oracle-symbol';
    image.src = symbol.url;
    image.alt = part;
    image.title = symbol.label;
    oracle.append(image);
  }
}
