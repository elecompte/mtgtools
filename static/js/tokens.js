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
  const powers = [...new Set(state.groups.map(group => group.counters))];
  powers.forEach(counters => {
    const card = tokenElement('section', null, 'statue-group');
    const members = state.groups.map((group, index) => ({group,index}))
      .filter(({group}) => group.counters === counters);
    const scene = tokenElement('div', null, 'statue-scene');
    const management = tokenElement('details', null, 'statue-management');
    management.append(tokenElement('summary', 'Manage ' + (1 + counters) + '/' + (1 + counters) + ' statues'));
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
      cohort.forEach(({group, index}) => {
    if (tokenControl) {
      const form = tokenElement('form', null, 'group-controls');
      const label = tokenElement('label', (group.tapped ? 'Tapped' : 'Untapped') + (group.sick ? ' · sick' : ' · ready') + ' · apply to ');
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
      management.append(form);
    }


      });
    }
    scene.dataset.count = visibleStates;
    card.append(scene, tokenElement('strong', (1 + counters) + '/' + (1 + counters), 'statue-pt'));
    if (tokenControl) {
      card.append(tokenElement('small', '+' + counters + ' counters', 'statue-counters'), management);
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
  const count = new Set(tokenState.groups.map(group => group.counters)).size;
  const columns = Math.max(1, Math.min(3, count));
  tokenGroups.style.width = (columns * 400) + 'px';
  tokenGroups.style.gridTemplateColumns = 'repeat(' + columns + ', 1fr)';
  const scale = Math.min(innerWidth / (columns * 400), innerHeight / Math.max(tokenGroups.scrollHeight, 1), 1);
  tokenGroups.style.transform = 'scale(' + scale + ')';
}
if (!tokenControl) addEventListener('resize', fitTokenBoard);
