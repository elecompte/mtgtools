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
function renderTokens(state) {
  tokenState = state;
  tokenGroups.replaceChildren();
  state.groups.forEach((group, index) => {
    const card = tokenElement('section', null, 'statue-group');
    const art = tokenElement('div', null, 'statue-art' + (group.tapped ? ' tapped' : ''));
    const icon = tokenElement('img', null, 'statue-icon');
    icon.src = '/static/img/statue-token.png';
    icon.alt = 'Stone statue';
    art.append(icon, tokenElement('strong', '×' + group.quantity, 'statue-quantity'));
    card.append(art, tokenElement('strong', (1 + group.counters) + '/' + (1 + group.counters), 'statue-pt'));
    card.append(tokenElement('span', '+' + group.counters + ' counters', 'statue-counters'));
    card.append(tokenElement('span', (group.tapped ? 'Tapped' : 'Untapped') + ' · ' + (group.sick ? 'Summoning sick' : 'Ready'), 'statue-state'));
    if (tokenControl) {
      const form = tokenElement('form', null, 'group-controls');
      const label = tokenElement('label', 'Apply to ');
      const qty = tokenElement('input');
      Object.assign(qty, {type:'number',min:'1',max:String(group.quantity),value:String(group.quantity),required:true});
      label.append(qty, ' tokens');
      form.append(label);
      for (const [action, text] of [
        [group.tapped ? 'untap' : 'tap', group.tapped ? 'Untap' : 'Tap'],
        [group.sick ? 'ready' : 'sick', group.sick ? 'Mark ready' : 'Mark sick'],
        ['counter_up','+1 counter'],['counter_down','−1 counter'],['remove','Remove / sacrifice']
      ]) {
        const button = tokenElement('button', text);
        button.type = 'submit';
        button.value = action;
        form.append(button);
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        sendTokenAction({action:event.submitter.value, index, group, quantity:Number(qty.value)});
      });
      card.append(form);
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
  }
}
async function sendTokenAction(action) {
  if (busy) return;
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
  document.querySelector('#create-tokens').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    sendTokenAction({action:'create', quantity:Number(form.elements.quantity.value),
      counters:Number(form.elements.counters.value), crusade:form.elements.crusade.checked});
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.action === 'clear' && !confirm('Clear all statues from the battlefield?')) return;
    sendTokenAction({action:button.dataset.action, quantity:Number(document.querySelector('#global-count').value)});
  }));
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
  const columns = Math.max(1, Math.min(6, tokenState.groups.length));
  const rows = Math.max(1, Math.ceil(tokenState.groups.length / columns));
  const scale = Math.min(innerWidth / (columns * 200), innerHeight / (rows * 260), 1);
  tokenGroups.style.width = (columns * 200) + 'px';
  tokenGroups.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)';
  tokenGroups.style.transform = 'scale(' + scale + ')';
}
if (!tokenControl) addEventListener('resize', fitTokenBoard);
