import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
process.env.ROBLOX_API_KEY = 'test-key';

// A fake Roblox: the web API, and Open Cloud user restrictions for universe 999.
let restriction = null; // what Roblox holds for user 1001
let silent = false;     // pretend a key without write permission: PATCH says OK but changes nothing
let forced = null;      // force an error status on the cloud API
const cloud = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
  if (u.includes('users.roblox.com/v1/usernames/users')) {
    const name = JSON.parse(opts.body).usernames[0];
    return ok({ data: name.toLowerCase() === 'builderman' ? [{ id: 1001, name: 'builderman', displayName: 'Builder' }] : [] });
  }
  if (u.includes('users.roblox.com/v1/users/1001')) return ok({ id: 1001, name: 'builderman', displayName: 'Builder' });
  if (u.includes('users.roblox.com/v1/users/')) return ok({}, 404);
  if (u.includes('/universes/v1/places/555/universe')) return ok({ universeId: 999 });
  if (u.includes('thumbnails.roblox.com')) return ok({ data: [{ imageUrl: 'https://t.rbxcdn.com/h.png' }] });
  if (u.includes('/cloud/v2/universes/999/user-restrictions/1001')) {
    cloud.push({ method: opts.method ?? 'GET', headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
    if (forced) return ok({}, forced);
    if (opts.method === 'PATCH' && !silent) {
      restriction = { gameJoinRestriction: { ...JSON.parse(opts.body).gameJoinRestriction, startTime: new Date().toISOString() } };
    }
    return restriction ? ok(restriction) : ok({}, 404);
  }
  throw new Error('unexpected ' + u);
};

const { config } = await import('../src/config.js');
const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ mongoUri: '', jsonPath: null });
const { updateSettings } = await import('../src/lib/settings.js');
const gameban = await import('../src/commands/gameban.js');

const sent = [];
const guild = { id: 'g1', channels: { fetch: async () => ({ isTextBased: () => true, send: async (m) => { sent.push(m); } }) } };
await updateSettings('g1', { placeId: '555', modLogChannel: 'log' });

function ix({ sub, user = 'owner1', roblox, member, reason, days }) {
  const calls = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  return {
    calls, guild, guildId: 'g1', user: { id: user, toString: () => `<@${user}>`, username: user },
    options: {
      getSubcommand: () => sub, getString: (k) => ({ roblox, reason })[k] ?? null,
      getUser: () => member ?? null, getInteger: () => days ?? null,
    },
    deferReply: rec('defer'), reply: rec('reply'), editReply: rec('editReply'),
  };
}
const said = (i) => textOf(i.calls.at(-1).p);
const reset = () => { restriction = null; silent = false; forced = null; cloud.length = 0; sent.length = 0; };

test('only people in ownerIds can use it, and it explains what is missing', async () => {
  reset();
  config.ownerIds = [];
  const none = ix({ sub: 'check', roblox: 'builderman' });
  await gameban.execute(none);
  assert.match(said(none), /No owners are set yet[\s\S]*config\.json/);

  config.ownerIds = ['owner1', 'owner2'];
  const stranger = ix({ sub: 'ban', user: 'randomguy', roblox: 'builderman', reason: 'x' });
  await gameban.execute(stranger);
  assert.match(said(stranger), /Only the game owners/);
  assert.equal(cloud.length, 0, 'nothing was sent to Roblox');

  const key = config.robloxApiKey;
  config.robloxApiKey = null;
  const nokey = ix({ sub: 'check', roblox: 'builderman' });
  await gameban.execute(nokey);
  assert.match(said(nokey), /ROBLOX_API_KEY/);
  config.robloxApiKey = key;

  await updateSettings('g1', { placeId: null });
  const nogame = ix({ sub: 'check', roblox: 'builderman' });
  await gameban.execute(nogame);
  assert.match(said(nogame), /Set the Roblox game in `\/setup`/);
  await updateSettings('g1', { placeId: '555' });
  assert.ok(gameban.data.toJSON().default_member_permissions, 'hidden from regular members too');
});

test('ban a player by username: sends the right request, checks it, logs it', async () => {
  reset();
  config.ownerIds = ['owner1'];
  const i = ix({ sub: 'ban', roblox: 'Builderman', reason: 'Exploiting', days: 7 });
  await gameban.execute(i);

  const patch = cloud.find((c) => c.method === 'PATCH');
  assert.equal(patch.headers['x-api-key'], 'test-key');
  assert.deepEqual(patch.body.gameJoinRestriction, {
    active: true, privateReason: 'Exploiting', displayReason: 'Exploiting', excludeAltAccounts: false, duration: '604800s',
  });
  assert.equal(cloud.at(-1).method, 'GET', 'it read the ban back to be sure');
  assert.match(said(i), /Banned from the game[\s\S]*builderman[\s\S]*7 days[\s\S]*Exploiting/);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /Game Ban[\s\S]*builderman[\s\S]*<@owner1>[\s\S]*Exploiting[\s\S]*7 days/);

  const check = ix({ sub: 'check', roblox: '1001' }); // by ID
  await gameban.execute(check);
  assert.match(said(check), /Banned[\s\S]*is banned from the game[\s\S]*Exploiting/);
});

test('permanent ban has no duration; ban by linked Discord member; unlinked members are explained', async () => {
  reset();
  config.ownerIds = ['owner1'];
  await store.links.set('d1', { robloxId: 1001, username: 'builderman' });
  const member = { id: 'd1', toString: () => '<@d1>' };
  const i = ix({ sub: 'ban', member, reason: 'Scamming' });
  await gameban.execute(i);
  assert.equal(cloud.find((c) => c.method === 'PATCH').body.gameJoinRestriction.duration, undefined);
  assert.match(said(i), /Permanent/);

  const stranger = ix({ sub: 'ban', member: { id: 'd9', toString: () => '<@d9>' }, reason: 'x' });
  await gameban.execute(stranger);
  assert.match(said(stranger), /hasn't linked a Roblox account/);

  const both = ix({ sub: 'check', member, roblox: 'builderman' });
  await gameban.execute(both);
  assert.match(said(both), /either a \*\*Roblox username or ID\*\*, or a \*\*member\*\*/);
  const neither = ix({ sub: 'check' });
  await gameban.execute(neither);
  assert.match(said(neither), /either a \*\*Roblox username or ID\*\*/);

  const ghost = ix({ sub: 'check', roblox: 'nobodyhere' });
  await gameban.execute(ghost);
  assert.match(said(ghost), /no Roblox account called \*\*nobodyhere\*\*/);
});

test('unban lifts it, and says so when they were not banned', async () => {
  reset();
  config.ownerIds = ['owner1'];
  await gameban.execute(ix({ sub: 'ban', roblox: 'builderman', reason: 'x' }));
  sent.length = 0;
  const un = ix({ sub: 'unban', roblox: 'builderman' });
  await gameban.execute(un);
  assert.match(said(un), /Ban lifted[\s\S]*can play again/);
  assert.deepEqual(cloud.filter((c) => c.method === 'PATCH').at(-1).body, { gameJoinRestriction: { active: false } });
  assert.match(textOf(sent[0]), /Game Unban/);

  const again = ix({ sub: 'unban', roblox: 'builderman' });
  await gameban.execute(again);
  assert.match(said(again), /isn't banned from the game/);
  const check = ix({ sub: 'check', roblox: 'builderman' });
  await gameban.execute(check);
  assert.match(said(check), /not banned/);
});

test('Roblox problems give clear messages and nothing is logged as done', async () => {
  reset();
  config.ownerIds = ['owner1'];
  const log = console.error; console.error = () => {};
  try {
    forced = 403;
    const denied = ix({ sub: 'ban', roblox: 'builderman', reason: 'x' });
    await gameban.execute(denied);
    assert.match(said(denied), /rejected the API key[\s\S]*game owner/);
    assert.equal(sent.length, 0);

    forced = 429;
    const busy = ix({ sub: 'ban', roblox: 'builderman', reason: 'x' });
    await gameban.execute(busy);
    assert.match(said(busy), /too many requests/);

    forced = null; silent = true; // a key without write permission: Roblox says OK but does nothing
    const fake = ix({ sub: 'ban', roblox: 'builderman', reason: 'x' });
    await gameban.execute(fake);
    assert.match(said(fake), /ban was not applied[\s\S]*WRITE/);
    assert.equal(sent.length, 0, 'a ban that did not happen is not logged');
  } finally {
    console.error = log;
  }
});

test('long reasons are cut to what Roblox accepts', async () => {
  reset();
  config.ownerIds = ['owner1'];
  const r = 'x'.repeat(300);
  await gameban.execute(ix({ sub: 'ban', roblox: 'builderman', reason: r }));
  const body = cloud.find((c) => c.method === 'PATCH').body.gameJoinRestriction;
  assert.equal(body.displayReason.length, 300);
  const { banPlayer } = await import('../src/lib/robloxban.js');
  await banPlayer(999, 1001, { reason: 'y'.repeat(2000) });
  const big = cloud.filter((c) => c.method === 'PATCH').at(-1).body.gameJoinRestriction;
  assert.equal(big.privateReason.length, 1000);
  assert.equal(big.displayReason.length, 400);
});
