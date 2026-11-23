(async () => {
  const control = document.body.classList.contains('obs-control');
  const frame = document.querySelector('#card-frame');
  const select = document.querySelector('#card');
  const status = document.querySelector('#sync');
  if (control) {
    const url = document.querySelector('#display-url');
    url.value = location.origin + '/obs';
    document.querySelector('#copy-url').onclick = async () => {
      try { await navigator.clipboard.writeText(url.value); }
      catch { url.select(); document.execCommand('copy'); }
    };
  }
  const endpoint = '/obs/state';
  const cards = ['valet','krenko','animpakal','scuteswarm','mana'];
  let current, ready = false, pending, sending = false, lastSent;
  const saved = control ? JSON.parse(localStorage.getItem('obs-cards-shared') || '{}') : {};

  function capture(doc) {
    const values = {};
    for (const el of doc.querySelectorAll('[id]:is(span,div,output):not(:has(*)), input[type=number]')) {
      values[el.id] = el.matches('input') ? el.value : el.textContent;
    }
    for (const toggle of doc.querySelectorAll('.mana-toggle')) values[toggle.dataset.color] = toggle.checked;
    return values;
  }

  function apply(doc, values) {
    for (const [id, value] of Object.entries(values)) {
      const el = doc.getElementById(id);
      if (el?.matches('span,output,div:not(:has(*))')) el.textContent = value;
      if (el?.matches('input[type=number]')) el.value = value;
    }
    for (const toggle of doc.querySelectorAll('.mana-toggle')) {
      const color = toggle.dataset.color;
      if (!(color in values)) continue;
      toggle.checked = values[color];
      doc.querySelector('.mana-tile[data-color="'+color+'"]').classList.toggle('is-hidden', !toggle.checked);
    }
  }

  async function publish() {
    if (sending || !pending) return;
    sending = true;
    const body = pending;
    try {
      const r = await fetch(endpoint, {method:'PUT', headers:{'Content-Type':'application/json'}, body});
      if (!r.ok) throw Error();
      lastSent = body;
      if (pending === body) pending = null;
      status.textContent = 'Synced to display';
    } catch { status.textContent = 'Connection lost · retrying'; }
    finally { sending = false; }
  }

  function snapshot() {
    if (!ready) return;
    const values = capture(frame.contentDocument);
    const body = JSON.stringify({card:current,values});
    if (body !== lastSent) {
      saved[current] = values;
      localStorage.setItem('obs-cards-shared', JSON.stringify(saved));
      pending = body;
    } else { pending = sending ? body : null; }
    publish();
  }

  let latest = {};
  function show(card, values) {
    if (!cards.includes(card)) return;
    latest = values || {};
    if (current === card) {
      if (ready && !control) apply(frame.contentDocument, latest);
      return;
    }
    current = card;
    ready = false;
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (doc.location.pathname !== '/' + card) return;
      if (!control) doc.body.classList.add('obs-readonly');
      apply(doc, latest);
      if (control) frame.contentWindow.restoreObsState?.(latest);
      if (control) {
        const resize = () => { frame.style.height = Math.ceil(doc.body.getBoundingClientRect().height + 4) + 'px'; };
        new ResizeObserver(resize).observe(doc.body);
      }
      ready = true;
      if (control) snapshot();
    };
    frame.src = '/' + card + '?overlay=1';
  }

  if (control) {
    select.value = localStorage.getItem('obs-active-card-shared') || 'valet';
    const previous = await fetch(endpoint, {cache:'no-store'});
    if (!previous.ok) throw Error('Could not load the display');
    const live = await previous.json();
    if (live && cards.includes(live.card)) {
      select.value = live.card;
      saved[live.card] = live.values;
    }
    const choose = () => {
      localStorage.setItem('obs-active-card-shared',select.value);
      show(select.value, saved[select.value]);
    };
    select.onchange = () => { snapshot(); choose(); };
    choose();
    setInterval(snapshot, 250);
  }
})().catch(() => {
  const status = document.querySelector('#sync');
  if (status) status.textContent = 'Could not connect. Reload OBS controls to reconnect.';
});
