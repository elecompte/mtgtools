const cards = {
  valet: ['Devilish Valet', 'Power', 'valet-power', 'valet.jpg', [['ETBs', 'etb-count']]],
  krenko: ['Krenko', 'Goblin tokens', 'token-total', 'krenko.jpg', [['Other goblins', 'goblins-count'], ['Krenkos', 'krenkos-count']]],
  animpakal: ['Anim Pakal', 'Gnome tokens', 'gnome-total', 'lands.jpg', [['Counters', 'counter-total'], ['Activations', 'activation-count']]],
  scuteswarm: ['Scute Swarm', 'Total swarms', 'swarm-total', 'scuteswarm.png', [['Lands played', 'lands'], ['Per land', 'doubler']]],
  mana: ['Floating mana', '', '', 'wubrg.png', []],
};
const colors = [
  ['white', 'W', '#fff2c3'], ['blue', 'U', '#80d1ff'], ['black', 'B', '#d2b6e1'],
  ['red', 'R', '#ffa18b'], ['green', 'G', '#9ce2a4'], ['colorless', 'C', '#d9dfe2'],
];
const byId = id => document.getElementById(id);
function element(parent, tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent.appendChild(node);
  return node;
}
function fitText(node, value, width) {
  node.textContent = value;
  node.removeAttribute('textLength');
  if (node.getComputedTextLength() > width) {
    node.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    node.setAttribute('textLength', width);
  }
}
function render({card, values}) {
  if (!Object.hasOwn(cards, card)) return;
  const [title, metric, key, image, details] = cards[card];
  byId('card-name').textContent = title;
  byId('art').setAttribute('href', '/static/img/' + image);
  byId('result').toggleAttribute('hidden', card === 'mana');
  byId('pool').toggleAttribute('hidden', card !== 'mana');
  if (card === 'mana') {
    const pool = byId('pool');
    pool.replaceChildren();
    colors.filter(([color]) => values[color] !== false).forEach(([color, symbol, fill], i) => {
      const x = 26 + (i % 3) * 185;
      const y = 88 + Math.floor(i / 3) * 149;
      element(pool, 'rect', {x, y, width:177, height:139, rx:12, fill:'#192625'});
      element(pool, 'text', {x:x+12, y:y+40, fill, 'font-size':36}).textContent = symbol;
      fitText(element(pool, 'text', {x:x+12, y:y+119, 'font-size':77, class:'number'}), values['value-' + color] ?? 0, 153);
    });
    return;
  }
  byId('metric').textContent = metric;
  fitText(byId('total'), values[key] ?? (card === 'valet' ? 1 : 0), 540);
  const footer = byId('details');
  footer.replaceChildren();
  details.forEach(([label, field], i) => {
    const x = 30 + i * 280;
    element(footer, 'text', {x, y:329, 'font-size':29, class:'label'}).textContent = label;
    fitText(element(footer, 'text', {x, y:382, 'font-size':48, class:'number'}), values[field] ?? 0, 250);
  });
}
let previous;
async function poll() {
  try {
    const response = await fetch('/obs/state', {cache:'no-store'});
    if (response.ok) {
      const state = await response.text();
      if (state !== previous) {
        render(JSON.parse(state));
        previous = state;
      }
    }
  } catch { /* Keep the last card visible while reconnecting. */ }
  finally { setTimeout(poll, 400); }
}
poll();
