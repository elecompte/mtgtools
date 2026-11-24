const itemsContainer = document.querySelector('#lookup-items');
const storeButtons = [...document.querySelectorAll('[data-store]')];
let selectedStore = 'all';
function filterResults(store) {
  selectedStore = store;
  const resultCards = [...itemsContainer.querySelectorAll('.lookup-result')];
  let visible = 0;
  resultCards.forEach(card => {
    const matches = JSON.parse(card.dataset.allMatches);
    const selected = store === 'all' ? matches : matches.filter(match => match.store === store);
    card.hidden = store === 'unavailable' ? card.dataset.state !== 'unavailable' :
      store !== 'all' && !selected.length;
    if (matches.length) card.dataset.matches = JSON.stringify(selected);
    if (!card.hidden) visible += 1;
  });
  storeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.store === store)));
  document.querySelector('#result-count').textContent = visible + ' of ' + resultCards.length + ' cards in this batch';
  document.querySelector('#result-empty').hidden = visible > 0 || !resultCards.length;
  const unavailableNames = resultCards.filter(card => card.dataset.state === 'unavailable')
    .map(card => card.querySelector('h2').textContent);
  const bulk = document.querySelector('#batch-watch');
  const signature = JSON.stringify(unavailableNames);
  if (bulk.dataset.names !== signature) {
    bulk.dataset.names = signature;
    bulk.hidden = !unavailableNames.length;
    const inputs = document.querySelector('#batch-watch-names');
    inputs.replaceChildren();
    unavailableNames.forEach(name => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'names';
      input.value = name;
      inputs.append(input);
    });
    bulk.querySelector('button').disabled = false;
    bulk.querySelector('button').textContent = 'Add unavailable to watchlist';
  }
}
storeButtons.forEach(button => button.addEventListener('click', () => filterResults(button.dataset.store)));
filterResults('all');
document.addEventListener('submit', async event => {
  const form = event.target.closest('.result-watch-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button');
  const status = form.querySelector('[role=status]');
  button.disabled = true;
  status.textContent = 'Adding…';
  try {
    const response = await fetch(form.action, {method:'POST', body:new FormData(form)});
    if (!response.ok) throw new Error();
    button.textContent = 'Added to watchlist';
    form.dataset.added = 'true';
    status.textContent = '';
  } catch {
    status.textContent = 'Could not add. Try again.';
    button.disabled = false;
  }
});
const next = document.querySelector('#lookup-next');
const batchProgress = document.createElement('p');
batchProgress.setAttribute('role', 'status');
itemsContainer.before(batchProgress);
async function pollResults() {
  try {
    const response = await fetch('/import_job/' + itemsContainer.dataset.job + '/progress', {cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    // Preserve completed rows, keyboard focus and watchlist actions as others finish.
    const template = document.createElement('template');
    template.innerHTML = data.html;
    const updated = [...template.content.querySelectorAll('.lookup-result')];
    [...itemsContainer.children].forEach((row, index) => {
      if (row.dataset.state === 'pending' && updated[index]?.dataset.state !== 'pending') {
        row.replaceWith(updated[index]);
      }
    });
    filterResults(selectedStore);
    batchProgress.textContent = 'Searched ' + data.current + ' of ' + data.total;
    if (data.status === 'done') {
      if (next) next.disabled = false;
      return;
    }
  } catch (error) {
    batchProgress.textContent = error.message || 'Connection lost. Retrying…';
  }
  setTimeout(pollResults, 1000);
}
if (itemsContainer.dataset.status !== 'done') pollResults();
if (next) {
  next.addEventListener('click', async () => {
    next.disabled = true;
    const status = document.querySelector('#scryfallNextStatus');
    status.textContent = 'Loading next batch…';
    try {
      const meta = JSON.parse(next.dataset.scryfall || 'null');
      let response;
      if (meta?.next_count) {
        response = await fetch('/scryfall_batch', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({query:meta.query, cursor:meta.cursor})
        });
        const batch = await response.json();
        if (!response.ok) throw new Error(batch.error);
        if (!batch.entries?.length) {
          status.textContent = 'No more cards.';
          return;
        }
        response = await fetch('/import_job', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            cardNames:batch.entries.map(card => ({...card, exact:true})),
            scryfall:{query:meta.query, cursor:batch.next_cursor, next_count:batch.next_count}
          })
        });
      } else {
        response = await fetch('/import_job/' + itemsContainer.dataset.job + '/next', {method:'POST'});
      }
      const job = await response.json();
      if (!response.ok) throw new Error(job.error);
      location.href = '/import_job/' + job.job_id + '/results';
    } catch (error) {
      status.textContent = error.message || 'Could not load the next batch.';
      next.disabled = false;
    }
  });
}
