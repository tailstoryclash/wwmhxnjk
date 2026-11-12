const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scenarios, transition } = require('../model.js');
for (const [id, scenario] of Object.entries(scenarios)) {
  test(`${id} produces the expected local outcome`, () => {
    assert.equal(transition('ready', 'run', id), scenario.outcome);
  });
}
test('challenge completion and cancellation', () => {
  assert.equal(transition('requires_action', 'complete'), 'succeeded');
  assert.equal(transition('requires_action', 'cancel'), 'canceled');
});
test('reset from every state', () => {
  for (const state of ['ready', 'succeeded', 'declined', 'requires_action', 'canceled']) {
    assert.equal(transition(state, 'reset'), 'ready');
  }
});
test('reject arbitrary scenarios and invalid state changes', () => {
  for (const scenario of ['custom', '__proto__', 'constructor', 'toString', undefined]) {
    assert.throws(() => transition('ready', 'run', scenario));
  }
  assert.throws(() => transition('ready', 'complete'));
  assert.throws(() => transition('succeeded', 'run', 'approved'));
  assert.throws(() => transition('declined', 'cancel'));
});
test('fixtures cannot be modified', () => {
  assert.ok(Object.isFrozen(scenarios));
  for (const fixture of Object.values(scenarios)) assert.ok(Object.isFrozen(fixture));
});
test('extension declares no website access and blocks outgoing connections', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  for (const key of ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'externally_connectable']) assert.equal(manifest[key], undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(manifest.content_security_policy.extension_pages, /form-action 'none'/);
});
