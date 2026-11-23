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
let activeMatches = [];
let matchIndex = 0;
function showMatch(index) {
  if (!activeMatches.length) return;
  matchIndex = (index + activeMatches.length) % activeMatches.length;
  const card = activeMatches[matchIndex];
  selectedCard = card;
  field('match-name').textContent = card.name;
  field('match-store').textContent = 'Store · ' + card.store;
  field('match-set').textContent = 'Listing set · ' + (card.set || 'Unavailable');
  field('match-price').textContent = card.price == null ? 'Price unavailable' :
    new Intl.NumberFormat(undefined, {style:'currency', currency:'USD'}).format(Number(card.price));
  field('match-store-link').href = card.url;
  const multiple = activeMatches.length > 1;
  field('match-prev').hidden = !multiple;
  field('match-next').hidden = !multiple;
  field('match-position').hidden = !multiple;
  field('match-position').textContent = 'Match ' + (matchIndex + 1) + ' of ' + activeMatches.length;
  dialog.classList.toggle('has-multiple', multiple);
  loadDetails(card);
}
document.querySelectorAll('[data-matches]').forEach(container => {
  const openMatches = () => {
    activeMatches = JSON.parse(container.dataset.matches);
    if (!activeMatches.length) return;
    dialog.showModal();
    showMatch(0);
  };
  container.addEventListener('click', event => {
    if (event.target.closest('button, form, a, input, select')) return;
    openMatches();
  });
  container.addEventListener('keydown', event => {
    if (event.target !== container || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    openMatches();
  });
});
field('match-prev').addEventListener('click', () => showMatch(matchIndex - 1));
field('match-next').addEventListener('click', () => showMatch(matchIndex + 1));
dialog.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    showMatch(matchIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  }
});
let touchStart;
const swipe = field('match-swipe');
swipe.addEventListener('touchstart', event => {
  touchStart = event.touches.length === 1 && !event.target.closest('a, button') ?
    {x:event.touches[0].clientX, y:event.touches[0].clientY} : null;
}, {passive:true});
swipe.addEventListener('touchend', event => {
  if (!touchStart || event.changedTouches.length !== 1) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    showMatch(matchIndex + (dx < 0 ? 1 : -1));
  }
}, {passive:true});
swipe.addEventListener('touchcancel', () => { touchStart = null; });
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
    symbolRequest = fetch('/watchlist/symbols?local=2', {cache: 'no-store'}).then(response => {
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
    const url = symbol && new URL(symbol.url, location.origin);
    if (!url || url.origin !== location.origin || !url.pathname.startsWith('/watchlist/media/')) {
      oracle.append(document.createTextNode(part));
      continue;
    }
    const image = document.createElement('img');
    image.className = 'oracle-symbol';
    image.src = url.href;
    image.alt = part;
    image.title = symbol.label;
    oracle.append(image);
  }
}
