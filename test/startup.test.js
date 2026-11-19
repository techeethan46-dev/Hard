import { test } from 'node:test';
import assert from 'node:assert/strict';

const { register } = await import('../src/lib/register.js');

// Registering the slash commands must never be able to keep the bot from starting.
test('registering commands never throws: a refusal from Discord is reported, not fatal', async () => {
  const ok = await register({ put: async (route, o) => { assert.equal(route, '/cmds'); assert.deepEqual(o.body, [{ name: 'x' }]); } }, '/cmds', [{ name: 'x' }]);
  assert.deepEqual(ok, { ok: true });
  const refused = await register({ put: async () => { throw new Error('You are being rate limited'); } }, '/cmds', []);
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /rate limited/);
});
