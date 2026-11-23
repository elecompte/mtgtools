const cards = {
  valet: ['Devilish Valet', 'Power', 'valet-power', 'valet.jpg', [['ETBs', 'etb-count']]],
  krenko: ['Krenko', 'Goblin tokens', 'token-total', 'krenko.jpg', [['Other goblins', 'goblins-count'], ['Krenkos', 'krenkos-count']]],
  animpakal: ['Anim Pakal', 'Gnome tokens', 'gnome-total', 'lands.jpg', [['Counters', 'counter-total'], ['Activations', 'activation-count']]],
  scuteswarm: ['Scute Swarm', 'Total swarms', 'swarm-total', 'scuteswarm.png', [['Lands played', 'lands'], ['Per land', 'doubler']]],
  mana: ['Floating mana', '', '', 'wubrg.png', []],
};
const colors = [
  ['white', 'plains', '#ece7d7', '#171914'],
  ['blue', 'island', '#123850', '#fff'],
  ['black', 'swamp', '#211d28', '#fff'],
  ['red', 'mountain', '#69291e', '#fff'],
  ['green', 'forest', '#17432d', '#fff'],
  ['colorless', 'colorless', '#363c42', '#fff'],
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
    colors.filter(([color]) => values[color] !== false).forEach(([color, art, tint, ink], i) => {
      const x = 26 + (i % 2) * 279;
      const y = 85 + Math.floor(i / 2) * 101;
      const bounds = {x, y, width: 269, height: 92};
      const clip = element(pool, 'clipPath', {id: 'tile-' + color});
      element(clip, 'rect', {...bounds, rx: 12});
      const tile = element(pool, 'g', {'clip-path': 'url(#tile-' + color + ')'});
      element(tile, 'image', {...bounds, href: '/static/img/' + art + '.png', preserveAspectRatio: 'xMidYMid slice'});
      element(tile, 'rect', {...bounds, fill: tint, opacity: 0.66});
      const center = {x: x + bounds.width / 2, 'text-anchor': 'middle', fill: ink};
      element(tile, 'text', {...center, y: y + 27, 'font-size': 25}).textContent = color.toUpperCase();
      fitText(element(tile, 'text', {...center, y: y + 81, 'font-size': 58, class: 'number'}),
        values['value-' + color] ?? 0, bounds.width - 20);
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
