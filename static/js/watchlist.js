document.querySelectorAll('time[datetime]').forEach(time => {
  const date = new Date(time.dateTime);
  if (!Number.isNaN(date.getTime())) {
    time.textContent = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(date);
    time.title = time.dateTime;
  }
});
const filter = document.querySelector('#watch-filter');
if (filter) {
  const items = [...document.querySelectorAll('.watch-item')];
  const update = () => {
    let visible = 0;
    items.forEach(item => {
      item.hidden = filter.value !== 'all' && item.dataset.state !== filter.value;
      if (!item.hidden) visible += 1;
    });
    document.querySelector('#watch-count').textContent = visible + (visible === 1 ? ' card' : ' cards');
    document.querySelector('#watch-empty-filter').hidden = visible !== 0;
  };
  filter.addEventListener('change', update);
  update();
}

const progress = document.querySelector('#check-progress');
if (progress && Number(progress.dataset.pending) > 0) {
  const poll = async () => {
    try {
      const response = await fetch('/watchlist/status', {cache:'no-store'});
      if (!response.ok) throw new Error();
      const {pending} = await response.json();
      if (!pending) {
        location.reload();
        return;
      }
      progress.textContent = pending + ' card(s) remaining · results will refresh automatically';
    } catch {
      progress.textContent = 'Reconnecting to check progress…';
    }
    setTimeout(poll, 2000);
  };
  poll();
}
