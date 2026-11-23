const resultCards = [...document.querySelectorAll('.lookup-result')];
const storeButtons = [...document.querySelectorAll('[data-store]')];
function filterResults(store) {
  let visible = 0;
  resultCards.forEach(card => {
    const matches = JSON.parse(card.dataset.allMatches);
    const selected = store === 'all' ? matches : matches.filter(match => match.store === store);
    card.hidden = store === 'unavailable' ? matches.length > 0 : store !== 'all' && !selected.length;
    if (matches.length) card.dataset.matches = JSON.stringify(selected);
    if (!card.hidden) visible += 1;
  });
  storeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.store === store)));
  document.querySelector('#result-count').textContent = visible + ' of ' + resultCards.length + ' searched cards';
  document.querySelector('#result-empty').hidden = visible > 0 || !resultCards.length;
}
storeButtons.forEach(button => button.addEventListener('click', () => filterResults(button.dataset.store)));
filterResults('all');
document.querySelectorAll('.result-watch-form').forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const status = form.querySelector('[role=status]');
    button.disabled = true;
    status.textContent = 'Adding…';
    try {
      const response = await fetch(form.action, {method:'POST', body:new FormData(form)});
      if (!response.ok) throw new Error();
      button.textContent = 'Added to watchlist';
      status.textContent = '';
    } catch {
      status.textContent = 'Could not add. Try again.';
      button.disabled = false;
    }
  });
});
