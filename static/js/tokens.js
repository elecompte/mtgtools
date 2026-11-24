const tokenControl = document.body.classList.contains('token-control');
const tokenGroups = document.querySelector('#token-groups');
const tokenDefinitions = JSON.parse(document.querySelector('#token-type-config').textContent);
const groupType = group => group.type || 'statue';
let tokenState = {groups:[]}, busy = false, writeVersion = 0;
if (tokenControl) document.querySelector('#token-url').value = location.origin + '/obs/tokens';
function tokenElement(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
// Statuses combine with OR; types narrow that selection. Keep choices across polls.
const tokenStatuses = new Set(['all']);
const tokenTypes = new Set(Object.keys(tokenDefinitions));
const createTypes = new Set(['statue']);
function bulkMatches(group, operation) {
  return tokenTypes.has(groupType(group)) && (tokenStatuses.has('all') || tokenStatuses.has(group.tapped ? 'tapped' : 'untapped')) &&
    (operation !== 'tap' || !group.tapped) && (operation !== 'untap' || group.tapped);
}
function renderBulkTypeChips() {
  const host = document.querySelector('#bulk-token-types');
  host.replaceChildren();
  const present = new Set(tokenState.groups.filter(group => group.quantity > 0).map(groupType));
  Object.entries(tokenDefinitions).forEach(([kind, definition]) => {
    if (!present.has(kind)) return;
    const button = tokenElement('button', definition.name);
    button.type = 'button';
    button.dataset.tokenType = kind;
    button.addEventListener('click', () => {
      if (tokenTypes.has(kind)) tokenTypes.delete(kind); else tokenTypes.add(kind);
      updateBulkControls();
    });
    host.append(button);
  });
}
function updateBulkControls() {
  document.querySelectorAll('[data-filter]').forEach(button => {
    const selected = button.dataset.filter === 'all'
      ? tokenStatuses.has('all') && [...document.querySelectorAll('[data-token-type]')].every(chip => tokenTypes.has(chip.dataset.tokenType))
      : tokenStatuses.has(button.dataset.filter);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[data-token-type]').forEach(button =>
    button.setAttribute('aria-pressed', String(tokenTypes.has(button.dataset.tokenType))));
  document.querySelectorAll('[data-bulk]').forEach(button => {
    button.disabled = !tokenState.groups.some(group => bulkMatches(group, button.dataset.bulk));
  });
  const count = tokenState.groups.filter(group => bulkMatches(group)).reduce((sum, group) => sum + group.quantity, 0);
  document.querySelector('#token-selected-count').textContent = count + ' selected';
}
function renderTokens(state) {
  tokenState = state;
  tokenGroups.replaceChildren();
  const powers = [...new Map(state.groups.map(group => [groupType(group) + ':' + group.counters, {kind:groupType(group), counters:group.counters}])).values()];
  powers.forEach(({kind, counters}) => {
    const definition = tokenDefinitions[kind];
    const card = tokenElement('section', null, 'statue-group');
    const members = state.groups.map((group, index) => ({group,index}))
      .filter(({group}) => group.counters === counters && groupType(group) === kind);
    const scene = tokenElement('div', null, 'statue-scene');
    const management = tokenElement('div', null, 'statue-management');
    const states = [
      {key:'ready', label:'Ready', select:group => !group.tapped && !group.sick},
      {key:'sick', label:'Summoning sick', select:group => !group.tapped && group.sick},
      {key:'tapped', label:'Tapped', select:group => group.tapped}
    ];
    let visibleStates = 0;
    for (const state of states) {
      const cohort = members.filter(({group}) => state.select(group));
      const quantity = cohort.reduce((sum, {group}) => sum + group.quantity, 0);
      if (!quantity) continue;
      visibleStates += 1;
      const figure = tokenElement('div', null, 'statue-figure state-' + state.key);
      const art = tokenElement('div', null, 'statue-art');
      const icon = tokenElement('span', null, 'statue-icon');
      icon.style.backgroundImage = 'url("' + definition.image + '")';
      const variant = counters % 8;
      icon.style.backgroundPosition = ((variant % 4) * 100 / 3) + '% ' + (Math.floor(variant / 4) * 100) + '%';
      icon.style.filter = 'hue-rotate(' + (Math.floor(counters / 8) * 47 % 360) + 'deg) drop-shadow(0 2px 2px #000a) drop-shadow(0 4px 5px #0009)';
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', definition.name + ' variant ' + (variant + 1));
      const badge = tokenElement('strong', quantity, 'statue-quantity');
      const digits = String(quantity).length;
      badge.style.fontSize = 'clamp(24px, ' + Math.min(16, 32 / digits) + 'cqw, 64px)';
      art.append(icon, badge);
      figure.append(art);
      figure.setAttribute('aria-label', quantity + ' ' + state.label + ' ' + definition.plural + ', ' +
        (definition.base + counters) + '/' + (definition.base + counters));
      scene.append(figure);
    }
    scene.dataset.count = visibleStates;
    const visual = tokenElement('div', null, 'token-group-visual');
    visual.append(scene, tokenElement('strong', (definition.base + counters) + '/' + (definition.base + counters), 'statue-pt'));
    visual.prepend(tokenElement('strong', definition.name, 'token-group-name'));
    card.append(visual);
    if (tokenControl) {
      const rows = [
        [['tap','ready',false,'TAP'],['tap','sick',false,'TAP SICK'],['tap','all',true,'TAP ALL']],
        [['untap','ready',false,'UNTAP'],['untap','sick',false,'UNTAP SICK'],['untap','all',true,'UNTAP ALL']],
        [['kill','untapped',false,'UNTAPPED'],['kill','tapped',false,'TAPPED'],['kill','sick',false,'SICK'],['kill','all',true,'ALL']],
        [['counter','untapped',false,'UNTAPPED'],['counter','tapped',false,'TAPPED'],['counter','sick',false,'SICK'],['counter','all',true,'ALL']]
      ];
      rows.forEach((buttons, rowIndex) => {
        if (rowIndex === 2) management.append(tokenElement('span', 'Kill', 'counter-row-label'));
        if (rowIndex === 3) management.append(tokenElement('span', 'Add counters', 'counter-row-label'));
        const row = tokenElement('div', null, 'token-button-row');
        buttons.forEach(([operation, target, all, text]) => {
          const eligible = members.some(({group}) => {
            if (operation === 'tap' && group.tapped) return false;
            if (operation === 'untap' && !group.tapped) return false;
            if (target === 'ready') return !group.sick;
            if (target === 'sick') return group.sick && (!['counter', 'kill'].includes(operation) || !group.tapped);
            if (target === 'untapped') return !group.tapped && !group.sick;
            if (target === 'tapped') return group.tapped;
            return true;
          });
          const button = tokenElement('button', text);
          button.type = 'button';
          button.disabled = !eligible;
          button.title = (all ? 'All eligible ' + definition.plural : 'One ' + definition.name) + ' in this P/T group';
          button.addEventListener('click', () => sendTokenAction({
            action:'group_action', type:kind, counters, operation, target, all
          }));
          row.append(button);
        });
        management.append(row);
      });
      card.append(management);
    }
    tokenGroups.append(card);
  });
  if (!tokenControl) fitTokenBoard();
  if (tokenControl) {
    const sum = predicate => state.groups.filter(predicate).reduce((n,g) => n+g.quantity,0);
    document.querySelector('#token-summary').textContent =
      sum(()=>true) + ' total · ' + sum(g=>!g.tapped) + ' untapped · ' +
      sum(g=>g.tapped) + ' tapped · ' + sum(g=>g.sick) + ' sick · ' +
      sum(g=>!g.sick) + ' ready · ' + sum(g=>g.counters>0) + ' with counters';
    document.querySelector('[data-action=undo]').disabled = !state.can_undo;
    renderBulkTypeChips();
    updateBulkControls();
  }
}
let tokenActionQueue = Promise.resolve();
function sendTokenAction(action) {
  tokenActionQueue = tokenActionQueue.then(() => performTokenAction(action));
  return tokenActionQueue;
}
async function performTokenAction(action) {
  busy = true;
  writeVersion += 1;
  try {
    const response = await fetch('/tokens/state', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(action)
    });
    if (!response.ok) throw Error(response.status === 409 ? 'State changed on another device. Refreshing groups. Please retry.' : 'Could not save. Check the quantity and retry.');
    renderTokens(await response.json());
    document.querySelector('#token-status').textContent = 'Synced to battlefield';
  } catch (error) {
    document.querySelector('#token-status').textContent = error.message;
  } finally { busy = false; }
}
if (tokenControl) {
  const createForm = document.querySelector('#create-tokens');
  const crusade = document.querySelector('#crusade-toggle');
  const createTapped = document.querySelector('#create-tapped-toggle');
  createTapped.addEventListener('click', () => {
    createTapped.setAttribute('aria-pressed', String(createTapped.getAttribute('aria-pressed') !== 'true'));
  });
  document.querySelectorAll('[data-create-type]').forEach(button => button.addEventListener('click', () => {
    const kind = button.dataset.createType;
    if (createTypes.has(kind)) createTypes.delete(kind); else createTypes.add(kind);
    button.setAttribute('aria-pressed', String(createTypes.has(kind)));
    document.querySelector('#create-token-button').disabled = !createTypes.size;
  }));
  crusade.addEventListener('click', () => {
    crusade.setAttribute('aria-pressed', String(crusade.getAttribute('aria-pressed') !== 'true'));
  });
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
    const input = createForm.elements.quantity;
    const current = Number(input.value);
    input.value = Math.max(1, Math.min(1000000, (Number.isFinite(current) ? current : 1) + Number(button.dataset.step)));
  }));
  createForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!createTypes.size) return;
    sendTokenAction({action:'create', types:[...createTypes], quantity:Number(createForm.elements.quantity.value),
      tapped:createTapped.getAttribute('aria-pressed') === 'true',
      crusade:crusade.getAttribute('aria-pressed') === 'true'});
  });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.filter === 'all') {
      tokenStatuses.clear();
      tokenStatuses.add('all');
      document.querySelectorAll('[data-token-type]').forEach(chip => tokenTypes.add(chip.dataset.tokenType));
    } else {
      const set = button.dataset.tokenType ? tokenTypes : tokenStatuses;
      const key = button.dataset.tokenType || button.dataset.filter;
      if (set === tokenStatuses) set.delete('all');
      if (set.has(key)) set.delete(key); else set.add(key);
    }
    updateBulkControls();
  }));
  document.querySelectorAll('[data-bulk]').forEach(button => button.addEventListener('click', () => {
    sendTokenAction({action:'bulk_action', operation:button.dataset.bulk,
      statuses:tokenStatuses.has('all') ? ['tapped', 'untapped'] : [...tokenStatuses], types:[...tokenTypes]});
  }));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    sendTokenAction({action:button.dataset.action});
  }));
  renderBulkTypeChips();
  updateBulkControls();
}
async function pollTokens() {
  const version = writeVersion;
  try {
    const response = await fetch('/tokens/state', {cache:'no-store'});
    if (!response.ok) throw Error();
    const state = await response.json();
    if (!busy && version === writeVersion && JSON.stringify(state) !== JSON.stringify(tokenState)) renderTokens(state);
  } catch {
    if (tokenControl) document.querySelector('#token-status').textContent = 'Connection lost · reconnecting…';
  } finally { setTimeout(pollTokens, 500); }
}
pollTokens();


function fitTokenBoard() {
  const canvas = document.querySelector('#token-canvas');
  const canvasWidth = 1200, canvasHeight = 900;
  const count = new Set(tokenState.groups.map(group => groupType(group) + ':' + group.counters)).size;
  const columns = Math.max(1, Math.min(5, count));
  // Measure at a stable native size so labels and badges scale with the artwork.
  tokenGroups.style.width = (columns * 400) + 'px';
  tokenGroups.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)';
  const groupHeight = Math.max(1, ...[...tokenGroups.children].map(card => card.offsetHeight));
  const preferredHeight = count < 4 ? canvasHeight / 3 : count === 4 ? 270 : 240;
  const scale = Math.min(preferredHeight / groupHeight,
    canvasWidth / (columns * 400), canvasHeight / Math.max(tokenGroups.scrollHeight, 1));
  tokenGroups.style.transform = 'scale(' + scale + ')';
  canvas.style.transform = 'scale(' + Math.min(innerWidth / canvasWidth, innerHeight / canvasHeight) + ')';
}
if (!tokenControl) addEventListener('resize', fitTokenBoard);
