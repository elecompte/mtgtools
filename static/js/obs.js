(async () => {
  const control = document.body.classList.contains('obs-control');
  const frame = document.querySelector('#card-frame');
  const select = document.querySelector('#card');
  const status = document.querySelector('#sync');
  const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  let display = location.hash.slice(1);
  let key;
  if (control) {
    key = /^[0-9a-f]{64}$/.test(display) ? display : localStorage.getItem('obs-control-key');
    if (!key) {
      key = hex(crypto.getRandomValues(new Uint8Array(32)));
    }
    localStorage.setItem('obs-control-key', key);
    document.querySelector('#control-url').value = location.origin + '/obs/control#' + key;
    // The server derives the public identifier too, including on plain LAN HTTP.
    const response = await fetch('/obs/display-id', {method: 'POST', headers: {'X-OBS-Key': key}});
    if (!response.ok) throw Error('Could not connect');
    display = await response.text();
    const url = document.querySelector('#display-url');
    url.value = location.origin + '/obs#' + display;
    document.querySelector('#copy-url').onclick = async () => {
      try { await navigator.clipboard.writeText(url.value); }
      catch { url.select(); document.execCommand('copy'); }
    };
  }
  if (!/^[a-f0-9]{64}$/.test(display)) {
    const setup = document.createElement('a');
    setup.href = '/obs/control';
    setup.textContent = 'Open OBS controls to get your display URL';
    frame.replaceWith(setup);
    return;
  }
  const endpoint = '/obs/state/' + display;
  const cards = ['valet','krenko','animpakal','scuteswarm','mana'];
  let current, ready = false, pending, sending = false, lastSent;
  const saved = control ? JSON.parse(localStorage.getItem('obs-cards-' + display) || '{}') : {};

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
      const r = await fetch(endpoint, {method:'PUT', headers:{'Content-Type':'application/json','X-OBS-Key':key}, body});
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
      localStorage.setItem('obs-cards-' + display, JSON.stringify(saved));
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
      const resize = () => { frame.style.height = Math.ceil(doc.body.getBoundingClientRect().height + 4) + 'px'; };
      new ResizeObserver(resize).observe(doc.body);
      ready = true;
      if (control) snapshot();
    };
    frame.src = '/' + card + '?overlay=1';
  }

  if (control) {
    select.value = localStorage.getItem('obs-active-card-' + display) || 'valet';
    const previous = await fetch(endpoint, {cache:'no-store'});
    if (!previous.ok) throw Error('Could not load the display');
    const live = await previous.json();
    if (live && cards.includes(live.card)) {
      select.value = live.card;
      saved[live.card] = live.values;
    }
    const choose = () => {
      localStorage.setItem('obs-active-card-' + display,select.value);
      show(select.value, saved[select.value]);
    };
    select.onchange = () => { snapshot(); choose(); };
    choose();
    setInterval(snapshot, 250);
  } else {
    async function poll() {
      try {
        const r = await fetch(endpoint, {cache:'no-store'});
        if (r.ok) {
          const state = await r.json();
          if (state) show(state.card, state.values);
        }
      } finally { setTimeout(() => poll().catch(() => {}), 400); }
    }
    await poll();
  }
})().catch(() => {
  const status = document.querySelector('#sync');
  if (status) status.textContent = 'Could not connect. Reload OBS controls to reconnect.';
});
