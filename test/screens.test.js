// Builds every screen the bot can show and runs discord.js's validation on it (what Discord would reject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField } from 'discord.js';
import { isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('/universes/v1/places/')) return ok({ universeId: 99 });
  if (url.includes('games.roblox.com/v1/games?')) {
    return ok({ data: [{ name: 'Cool Game', playing: 1234, visits: 98765432, favoritedCount: 54321, maxPlayers: 20,
      updated: '2026-11-10T00:00:00Z', description: 'A very cool game.', creator: { name: 'Cool Studio', hasVerifiedBadge: true } }] });
  }
  if (url.includes('/games/icons')) return ok({ data: [{ imageUrl: 'https://tr.rbxcdn.com/icon.png' }] });
  if (url.includes('/games/multiget/thumbnails')) return ok({ data: [{ thumbnails: [{ imageUrl: 'https://tr.rbxcdn.com/banner.png' }] }] });
  if (url.includes('avatar-headshot')) return ok({ data: [{ imageUrl: 'https://tr.rbxcdn.com/head.png' }] });
  if (url.includes('/v1/usernames/users')) return ok({ data: [{ id: 1001, name: 'builderman', displayName: 'Builder' }] });
  if (url.match(/users\.roblox\.com\/v1\/users\/1001$/)) {
    return ok({ id: 1001, name: 'builderman', displayName: 'Builder', description: 'Hi there', created: '2010-01-01T00:00:00Z', hasVerifiedBadge: true });
  }
  return { ok: false, status: 404 };
};

const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ jsonPath: null });
const { updateSettings } = await import('../src/lib/settings.js');
await updateSettings('g1', { placeId: '123', gameName: 'Cool Game', modLogChannel: 'log', suggestionsChannel: 'sug', welcomeChannel: 'wel', verifiedRole: 'r1', ticketCategory: 'cat' });

const ALL = new PermissionsBitField(PermissionsBitField.All);
const sent = {};
const chan = (id) => ({ id, isTextBased: () => true, toString: () => `<#${id}>`, send: async (m) => { sent[id] = m; return { url: 'https://discord.com/x', react: async () => {}, startThread: async () => {} }; } });
const user = (id) => ({ id, tag: `${id}#0`, username: id, toString: () => `<@${id}>`, displayAvatarURL: () => 'https://cdn.discordapp.com/a.png', send: async (m) => { sent[`dm:${id}`] = m; } });
const guild = {
  id: 'g1', name: 'Cool Server', memberCount: 1500, ownerId: 'owner', iconURL: () => 'https://cdn.discordapp.com/icon.png',
  roles: { cache: new Map([['r1', { id: 'r1', name: 'Verified', position: 1 }]]) },
  channels: { cache: new Map([['log', { permissionsFor: () => ALL }]]), fetch: async (id) => chan(id) },
  members: { me: { roles: { highest: { position: 10 } }, permissions: ALL } },
};
const member = (id) => ({
  id, user: user(id), guild, displayName: id, manageable: true, nickname: null, toString: () => `<@${id}>`,
  roles: { cache: { has: () => false }, add: async () => {}, remove: async () => {} }, setNickname: async () => {},
});
function interaction(opts = {}) {
  const calls = [];
  const rec = async (p) => { calls.push(p); };
  return {
    calls, guild, guildId: 'g1', user: user('u1'), member: member('u1'), channel: chan('here'),
    memberPermissions: ALL,
    options: { getString: (k) => opts[k] ?? null, getUser: () => null, getMember: () => null, getSubcommand: () => opts.sub, getChannel: () => null, getInteger: () => null },
    reply: rec, editReply: rec, followUp: rec, update: rec, deferReply: async () => {}, deferUpdate: async () => {}, showModal: rec,
    ...opts,
  };
}
const check = (payload, ...expect) => {
  assert.ok(isV2(payload), 'uses the card layout');
  json(payload); // throws on anything Discord would reject
  const t = textOf(payload);
  for (const e of expect) assert.match(t, e);
  return t;
};

test('/game card', async () => {
  const i = interaction();
  await (await import('../src/commands/game.js')).execute(i);
  check(i.calls[0], /### Cool Game/, /1,234\*\* playing/, /98\.8M/, /Cool Studio ☑️/);
  assert.match(JSON.stringify(json(i.calls[0])), /banner\.png/);
});

test('/whois card', async () => {
  const i = interaction({ username: 'builderman' });
  await (await import('../src/commands/whois.js')).execute(i);
  check(i.calls[0], /### Builder ☑️/, /@builderman/, /Joined Roblox/, /Not linked/);
});

test('verify: code screen and success card', async () => {
  const verify = await import('../src/commands/verify.js');
  const i = interaction({ username: 'builderman' });
  await verify.execute(i);
  check(i.calls[0], /Verify as Builder/, /1 · Copy this code/, /```[a-z ]+```/);

  const { code } = await store.pending.get('u1');
  globalThis.fetch = ((orig) => async (url, o) => (String(url).match(/v1\/users\/1001$/)
    ? ok({ id: 1001, name: 'builderman', displayName: 'Builder', description: code, created: '2010-01-01T00:00:00Z' })
    : orig(url, o)))(globalThis.fetch);
  const done = interaction({ customId: 'verify:check' });
  await verify.handleButton(done);
  check(done.calls.at(-1), /You're verified!/, /builderman/);
});

test('panels', async () => {
  const { verifyPanel, ticketPanel } = await import('../src/commands/panel.js');
  check(await verifyPanel(guild), /Verify your Roblox account/, /How it works/, /Cool Game/);
  check(ticketPanel(guild), /Need a hand\?/, /Report a Player/, /Someone breaking the rules/);
});

test('welcome, suggestion, mod log, DM notice', async () => {
  await (await import('../src/events/guildMemberAdd.js')).execute(member('newbie'));
  check(sent.wel, /Welcome, newbie!/, /home of \*\*Cool Game\*\*/, /member #1,500/);
  assert.deepEqual(sent.wel.allowedMentions, { users: ['newbie'] });

  const i = interaction({ idea: 'Add pets\nand hats' });
  await (await import('../src/commands/suggest.js')).execute(i);
  check(sent.sug, /New suggestion/, /> Add pets\n> and hats/);
  check(i.calls[0], /Suggestion posted/);

  const { modLog } = await import('../src/lib/ui.js');
  await modLog(guild, { action: 'Ban', target: user('bad'), moderator: user('mod'), reason: 'Exploiting' });
  check(sent.log, /🔨 Ban/, /Exploiting/, /User ID bad/);

  const { notify } = await import('../src/lib/moderation.js');
  await notify(user('bad'), guild, { kind: 'bad', title: 'You were banned', reason: 'Exploiting' });
  check(sent['dm:bad'], /Cool Server/, /You were banned/, /> Exploiting/);
});

test('setup finish screen offers to post panels here', async () => {
  const setup = await import('../src/commands/setup.js');
  const i = interaction({ customId: 'setup:finish' });
  await setup.handleButton(i);
  check(i.calls[0], /You're all set!/, /Verify panel/, /Ticket panel/);

  const post = interaction({ customId: 'setup:post:verify' });
  await setup.handleButton(post);
  check(sent.here, /Verify your Roblox account/);
  check(post.calls[0], /Posted in/);
});

test('notices', async () => {
  const { notice } = await import('../src/lib/ui.js');
  check(notice('ok', 'Done'), /✅ {2}Done/);
  check(notice('bad', 'Nope', { title: 'Not allowed' }), /### ⛔ Not allowed\nNope/);
  assert.ok(notice('ok', 'x').flags & 64);
  assert.ok(!(notice('ok', 'x', { ephemeral: false }).flags & 64));
});
