const tokenControl = document.body.classList.contains('token-control');
const tokenGroups = document.querySelector('#token-groups');
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
const tokenTypes = new Set(['statue']);
function bulkMatches(group, operation) {
  return tokenTypes.has('statue') && (tokenStatuses.has('all') || tokenStatuses.has(group.tapped ? 'tapped' : 'untapped')) &&
    (operation !== 'tap' || !group.tapped) && (operation !== 'untap' || group.tapped);
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
  const powers = [...new Set(state.groups.map(group => group.counters))];
  powers.forEach(counters => {
    const card = tokenElement('section', null, 'statue-group');
    const members = state.groups.map((group, index) => ({group,index}))
      .filter(({group}) => group.counters === counters);
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
      const variant = counters % 8;
      icon.style.backgroundPosition = ((variant % 4) * 100 / 3) + '% ' + (Math.floor(variant / 4) * 100) + '%';
      icon.style.filter = 'hue-rotate(' + (Math.floor(counters / 8) * 47 % 360) + 'deg)';
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', 'Tiki statue expression ' + (variant + 1));
      const badge = tokenElement('strong', quantity, 'statue-quantity');
      const digits = String(quantity).length;
      badge.style.fontSize = 'clamp(24px, ' + Math.min(16, 32 / digits) + 'cqw, 64px)';
      art.append(icon, badge);
      figure.append(art);
      figure.setAttribute('aria-label', quantity + ' ' + state.label + ' statues, ' +
        (1 + counters) + '/' + (1 + counters));
      scene.append(figure);
    }
    scene.dataset.count = visibleStates;
    card.append(scene, tokenElement('strong', (1 + counters) + '/' + (1 + counters), 'statue-pt'));
    if (tokenControl) {
      const rows = [
        [['tap','ready',false,'TAP'],['tap','sick',false,'TAP SICK'],['tap','all',true,'TAP ALL']],
        [['untap','ready',false,'UNTAP'],['untap','sick',false,'UNTAP SICK'],['untap','all',true,'UNTAP ALL']],
        [['kill','ready',false,'KILL'],['kill','sick',false,'KILL SICK'],['kill','all',true,'KILL ALL']],
        [['counter','untapped',false,'UNTAPPED'],['counter','tapped',false,'TAPPED'],['counter','sick',false,'SICK'],['counter','all',true,'ALL']]
      ];
      rows.forEach((buttons, rowIndex) => {
        if (rowIndex === 3) management.append(tokenElement('span', 'Add counters', 'counter-row-label'));
        const row = tokenElement('div', null, 'token-button-row');
        buttons.forEach(([operation, target, all, text]) => {
          const eligible = members.some(({group}) => {
            if (operation === 'tap' && group.tapped) return false;
            if (operation === 'untap' && !group.tapped) return false;
            if (target === 'ready') return !group.sick;
            if (target === 'sick') return group.sick && (operation !== 'counter' || !group.tapped);
            if (target === 'untapped') return !group.tapped && !group.sick;
            if (target === 'tapped') return group.tapped;
            return true;
          });
          const button = tokenElement('button', text);
          button.type = 'button';
          button.disabled = !eligible;
          button.title = (all ? 'All eligible statues' : 'One statue') + ' in this P/T group';
          button.addEventListener('click', () => sendTokenAction({
            action:'group_action', counters, operation, target, all
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
    sendTokenAction({action:'create', quantity:Number(createForm.elements.quantity.value),
      crusade:crusade.getAttribute('aria-pressed') === 'true'});
  });
  document.querySelectorAll('[data-filter], [data-token-type]').forEach(button => button.addEventListener('click', () => {
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
  const count = new Set(tokenState.groups.map(group => group.counters)).size;
  const columns = Math.max(1, Math.min(3, count));
  tokenGroups.style.width = (columns * 400) + 'px';
  tokenGroups.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)';
  const scale = Math.min(innerWidth / (columns * 400), innerHeight / Math.max(tokenGroups.scrollHeight, 1), 1);
  tokenGroups.style.transform = 'scale(' + scale + ')';
}
if (!tokenControl) addEventListener('resize', fitTokenBoard);
