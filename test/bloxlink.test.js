import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN = 'x';
process.env.BLOXLINK_API_KEY = 'test-key';

let reply;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const u = String(url);
  if (u.includes('api.blox.link')) return reply(u);
  if (u.includes('users.roblox.com/v1/users/1001')) return { ok: true, status: 200, json: async () => ({ id: 1001, name: 'builderman', displayName: 'Builder' }) };
  if (u.includes('thumbnails.roblox.com')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
  throw new Error('unexpected ' + u);
};

const { bloxlinkEnabled, lookupRoblox } = await import('../src/lib/bloxlink.js');
const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ mongoUri: '', jsonPath: null });
await (await import('../src/lib/settings.js')).updateSettings('g1', { verifiedRole: 'r-verified' });
const verify = await import('../src/commands/verify.js');
const { textOf, customIds } = await import('./helpers.js');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (n) => ({ ok: false, status: n, json: async () => ({}) });

function interaction() {
  const held = new Set();
  const out = { replies: [] };
  const member = {
    id: 'd1', nickname: null, manageable: true,
    guild: { id: 'g1', ownerId: 'o', roles: { cache: new Map([['r-verified', { id: 'r-verified', position: 1 }]]) }, members: { me: { roles: { highest: { position: 5 } } } } },
    roles: { cache: { has: (r) => held.has(r) }, add: async (r) => held.add(r), remove: async (r) => held.delete(r) },
    setNickname: async (n) => { member.nickname = n; },
  };
  return Object.assign(out, {
    held, guildId: 'g1', user: { id: 'd1' }, member, options: { getString: () => null },
    deferReply: async () => {}, deferUpdate: async () => {},
    editReply: async (p) => { out.replies.push(p); },
  });
}

test('Bloxlink is enabled and the lookup uses the server key and URL', async () => {
  assert.ok(bloxlinkEnabled());
  reply = () => ok({ robloxID: '1001' });
  assert.equal(await lookupRoblox('g1', 'd1'), 1001);
  const c = calls.at(-1);
  assert.equal(c.url, 'https://api.blox.link/v4/public/guilds/g1/discord-to-roblox/d1');
  assert.equal(c.opts.headers.authorization, 'test-key');
});

test('lookup: not linked is null, errors throw', async () => {
  reply = () => status(404);
  assert.equal(await lookupRoblox('g1', 'd1'), null);
  reply = () => status(429);
  await assert.rejects(lookupRoblox('g1', 'd1'), /busy/);
  reply = () => status(403);
  await assert.rejects(lookupRoblox('g1', 'd1'), /API key/);
  reply = () => status(500);
  await assert.rejects(lookupRoblox('g1', 'd1'), /500/);
});

test('/verify links a member Bloxlink knows and gives roles', async () => {
  reply = () => ok({ robloxID: 1001 });
  const i = interaction();
  await verify.execute(i);
  assert.equal((await store.links.get('d1')).robloxId, 1001);
  assert.ok(i.held.has('r-verified'));
  assert.match(textOf(i.replies.at(-1)), /verified/);
});

test('/verify tells unlinked members to verify with Bloxlink and offers Check again', async () => {
  await store.links.delete?.('d1');
  reply = () => status(404);
  const i = interaction();
  i.user.id = 'd2'; i.member.id = 'd2';
  await verify.execute(i);
  assert.equal(await store.links.get('d2'), null);
  assert.match(textOf(i.replies.at(-1)), /Bloxlink/);
  assert.ok(customIds(i.replies.at(-1)).includes('verify:bloxlink'));
});

test('Bloxlink being down gives a friendly message, not a crash', async () => {
  reply = () => status(500);
  const i = interaction();
  i.user.id = 'd3'; i.member.id = 'd3';
  const log = console.error; console.error = () => {};
  await verify.execute(i);
  console.error = log;
  assert.match(textOf(i.replies.at(-1)), /try again/i);
});
