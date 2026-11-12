'use strict';
(() => {
  const scenarios = Object.freeze({
    approved: Object.freeze({ title: 'Approved payment', card: '4242 4242 4242 4242', outcome: 'succeeded' }),
    declined: Object.freeze({ title: 'Generic decline', card: '4000 0000 0000 0002', outcome: 'declined' }),
    challenge: Object.freeze({ title: 'Verification required', card: '4000 0000 0000 3220', outcome: 'requires_action' })
  });
  const messages = Object.freeze({
    ready: 'Choose a scenario and run a local simulation.',
    succeeded: 'Simulated approval. No payment was sent or charged.',
    declined: 'Simulated decline: generic_decline. No payment request was sent.',
    requires_action: 'Simulated verification challenge. Choose its outcome below.',
    canceled: 'Simulated verification canceled. No payment was sent or charged.'
  });
  function transition(state, event, scenario) {
    if (event === 'reset') return 'ready';
    if (event === 'run' && state === 'ready' && Object.hasOwn(scenarios, scenario)) {
      return scenarios[scenario].outcome;
    }
    if (state === 'requires_action' && event === 'complete') return 'succeeded';
    if (state === 'requires_action' && event === 'cancel') return 'canceled';
    throw new Error('Invalid simulation transition');
  }
  const api = Object.freeze({ scenarios, messages, transition });
  globalThis.CheckoutSimulator = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
