if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', {updateViaCache: 'none'}).catch(console.error);
}

if (document.body.classList.contains('tool') && new URLSearchParams(location.search).get('overlay') === '1') {
  document.body.classList.add('overlay');
}

const swarmForm = document.querySelector('#swarm-form');
if (swarmForm) {
  swarmForm.addEventListener('click', event => {
    const step = event.target.dataset.step;
    if (!step) return;
    const input = event.target.parentElement.querySelector('input');
    input.stepUp(Number(step));
  });
  swarmForm.addEventListener('submit', event => {
    event.preventDefault();
    const { initial, lands, doubler } = swarmForm.elements;
    const total = lands.valueAsNumber === 0 ? 0 :
      initial.valueAsNumber * (1 + doubler.valueAsNumber) ** lands.valueAsNumber;
    document.querySelector('#swarm-total').textContent = total.toLocaleString();
    if (Number.isFinite(total)) initial.value = total;
  });
}
if (document.body.classList.contains('portal-page')) {
  const updateConnection = () => {
    document.querySelectorAll('button[type="submit"], #scryfallNextButton').forEach(button => {
      button.disabled = !navigator.onLine;
    });
    document.querySelector('#connection-status').textContent = navigator.onLine ? '' : 'Connect to the internet to search live store inventory.';
  };
  const status = document.createElement('p');
  status.id = 'connection-status';
  status.setAttribute('role', 'status');
  document.querySelector('main').prepend(status);
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  updateConnection();
}
