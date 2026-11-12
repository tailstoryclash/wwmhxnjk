'use strict';
const { scenarios, messages, transition } = globalThis.CheckoutSimulator;
const elements = Object.fromEntries(['scenario', 'card', 'run', 'result', 'challenge', 'complete', 'cancel', 'reset'].map(id => [id, document.getElementById(id)]));
let state = 'ready';
function render() {
  elements.card.textContent = scenarios[elements.scenario.value].card;
  elements.result.textContent = messages[state];
  elements.result.dataset.state = state;
  elements.challenge.hidden = state !== 'requires_action';
  elements.run.disabled = state !== 'ready';
}
function dispatch(event) {
  state = transition(state, event, elements.scenario.value);
  render();
}
elements.scenario.addEventListener('change', () => dispatch('reset'));
for (const event of ['run', 'complete', 'cancel', 'reset']) {
  elements[event].addEventListener('click', () => {
    dispatch(event);
    if (state === 'requires_action') elements.complete.focus();
    else if (event === 'complete' || event === 'cancel') elements.reset.focus();
    else if (event === 'reset') elements.run.focus();
  });
}
render();
