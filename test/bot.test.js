// Offline tests: Roblox API responses are mocked, Discord objects are minimal fakes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';

process.env.DISCORD_TOKEN = 'x';
process.env.ROBLOX_GROUP_ID = '42';
process.env.VERIFIED_ROLE_ID = 'r-verified';
process.env.UNVERIFIED_ROLE_ID = 'r-unverified';

const profiles = { 1001: { id: 1001, name: 'builderman', displayName: 'Builder', description: '', created: '2006-01-01T00:00:00Z' } };
let groupRank = 0;
globalThis.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (url.includes('/v1/usernames/users')) {
    const name = JSON.parse(opts.body).usernames[0].toLowerCase();
    return ok({ data: Object.values(profiles).filter((p) => p.name === name) });
  }
  const m = url.match(/users\.roblox\.com\/v1\/users\/(\d+)$/);
  if (m) return profiles[m[1]] ? ok(profiles[m[1]]) : { ok: false, status: 404 };
  if (url.includes('/groups/roles')) {
    return ok({ data: groupRank ? [{ group: { id: 42 }, role: { name: 'Rank', rank: groupRank } }] : [] });
  }
  throw new Error('unexpected fetch ' + url);
};

let config, db, verify, roles, loadCommands;
before(async () => {
  ({ config } = await import('../src/config.js'));
  config.groupRankBindings = [
    { minRank: 1, maxRank: 254, roleId: 'r-member' },
    { minRank: 200, maxRank: 255, roleId: 'r-staff' },
  ];
  ({ db } = await import('../src/lib/store.js'));
  db.path = mkdtempSync('/tmp/botdb-') + '/db.json'; // don't touch real data
  db.data = { links: {}, pending: {}, warnings: {} };
  verify = await import('../src/commands/verify.js');
  roles = await import('../src/lib/roles.js');
  ({ loadCommands } = await import('../src/lib/loader.js'));
});

function fakeMember(id = 'u1') {
  const allRoles = ['r-verified', 'r-unverified', 'r-member', 'r-staff'];
  const cache = new Map(allRoles.map((r) => [r, { id: r, name: r, position: 1 }]));
  const held = new Set();
  const member = {
    id, nickname: null, manageable: true,
    guild: { ownerId: 'owner', roles: { cache }, members: { me: { roles: { highest: { position: 10 } } } } },
    roles: {
      cache: { has: (r) => held.has(r) },
      add: async (r) => held.add(r),
      remove: async (r) => held.delete(r),
    },
    setNickname: async (n) => { member.nickname = n; },
    held,
  };
  return member;
}

function fakeInteraction(member, options = {}) {
  const calls = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  return {
    user: { id: member.id }, member, calls,
    customId: options.customId, guildId: 'g1',
    options: { getString: (k) => options[k] ?? null },
    deferReply: rec('deferReply'), deferUpdate: rec('deferUpdate'), editReply: rec('editReply'),
    followUp: rec('followUp'), update: rec('update'), reply: rec('reply'),
  };
}
const lastText = (i) => JSON.stringify(i.calls.at(-1).p);

test('every command builds valid slash-command JSON', async () => {
  const cmds = await loadCommands();
  assert.ok(cmds.size >= 12);
  for (const [name, c] of cmds) {
    const json = c.data.toJSON();
    assert.equal(json.name, name);
    assert.equal(typeof c.execute, 'function');
  }
});

test('unverified member gets the Unverified role only', async () => {
  const m = fakeMember('new');
  await roles.syncMember(m);
  assert.deepEqual([...m.held], ['r-unverified']);
});

test('full verify flow: wrong code is rejected, right code links and syncs roles', async () => {
  const m = fakeMember('u1');
  m.held.add('r-unverified');
  groupRank = 210;

  const i1 = fakeInteraction(m, { username: 'BuilderMan' });
  await verify.execute(i1);
  const pending = db.data.pending.u1;
  assert.equal(pending.robloxId, 1001);
  assert.match(pending.code, /^(\w+ ){5}\w+$/);

  // Code not in profile yet
  const i2 = fakeInteraction(m, { customId: 'verify:check' });
  await verify.handleButton(i2);
  assert.equal(i2.calls.at(-1).kind, 'followUp');
  assert.ok(!db.data.links.u1);

  // Code present (with odd casing/spacing, as people paste it)
  profiles[1001].description = `hi!  ${pending.code.toUpperCase().replace(/ /g, '   ')} bye`;
  const i3 = fakeInteraction(m, { customId: 'verify:check' });
  await verify.handleButton(i3);
  assert.match(lastText(i3), /Verified!/);
  assert.equal(db.data.links.u1.robloxId, 1001);
  assert.ok(!db.data.pending.u1);
  assert.deepEqual([...m.held].sort(), ['r-member', 'r-staff', 'r-verified']);
  assert.equal(m.nickname, 'Builder (@builderman)');
});

test('demotion in the group removes the staff role on resync', async () => {
  const m = fakeMember('u1');
  ['r-verified', 'r-member', 'r-staff'].forEach((r) => m.held.add(r));
  groupRank = 5;
  const r = await roles.syncMember(m);
  assert.deepEqual(r.removed, ['r-staff']);
  assert.deepEqual([...m.held].sort(), ['r-member', 'r-verified']);
});

test('expired code is refused', async () => {
  const m = fakeMember('u2');
  db.data.pending.u2 = { robloxId: 1001, username: 'builderman', code: 'a b c', expiresAt: Date.now() - 1 };
  const i = fakeInteraction(m, { customId: 'verify:check' });
  await verify.handleButton(i);
  assert.match(lastText(i), /expired/);
  assert.ok(!db.data.links.u2);
});

test('roles above the bot are reported, not crashed on', async () => {
  const m = fakeMember('u3');
  m.guild.roles.cache.get('r-unverified').position = 99;
  const r = await roles.syncMember(m);
  assert.match(r.errors[0], /move the bot's role above it/);
});

test('without OAuth configured, /verify with no username asks for it in a form', async () => {
  const m = fakeMember('u4');
  const i = fakeInteraction(m);
  i.showModal = async (modal) => i.calls.push({ kind: 'modal', p: modal.toJSON() });
  await verify.execute(i);
  assert.equal(i.calls[0].kind, 'modal');
  assert.equal(i.calls[0].p.custom_id, 'verify:modal');
});
