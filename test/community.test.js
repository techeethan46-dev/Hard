import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { buttonLabels, customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-05-01T12:00:00Z') });

const { initStore } = await import('../src/lib/store.js');
await initStore({ jsonPath: null });
const { getSettings } = await import('../src/lib/settings.js');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

// ---------------------------------------------------------------- sticky

const sticky = await import('../src/lib/sticky.js');
function makeChannel() {
  const ch = { id: 'c1', guildId: 'g1', lastMessageId: null, sent: [], deleted: [], n: 0 };
  ch.send = async (m) => { const id = `s${++ch.n}`; ch.sent.push(m); ch.lastMessageId = id; return { id }; };
  ch.messages = { delete: async (id) => { ch.deleted.push(id); } };
  return ch;
}
const chat = (ch, id) => { ch.lastMessageId = id; return { id, inGuild: () => true, guildId: 'g1', channelId: ch.id, channel: ch }; };

test('sticky: set, repost after chat goes quiet, never more than one copy', async () => {
  const ch = makeChannel();
  await sticky.setSticky(ch, { title: 'Rules', text: 'Be nice!' });
  assert.match(textOf(ch.sent[0]), /📌 Rules\nBe nice!/);
  json(ch.sent[0]);
  assert.equal((await getSettings('g1')).stickies.c1.messageId, 's1');

  // a burst of chat: only one repost, 4s after the last message
  for (const id of ['m1', 'm2', 'm3']) { await sticky.onMessageForSticky(chat(ch, id)); mock.timers.tick(1000); }
  assert.equal(ch.sent.length, 1);
  mock.timers.tick(4000);
  await flush(); await flush();
  assert.equal(ch.sent.length, 2);
  assert.deepEqual(ch.deleted, ['s1']);
  assert.equal((await getSettings('g1')).stickies.c1.messageId, 's2');

  // the bot's own repost doesn't trigger another one
  await sticky.onMessageForSticky(chat(ch, 's2'));
  mock.timers.tick(5000); await flush();
  assert.equal(ch.sent.length, 2);
});

test('sticky: a busy channel still gets a repost within 15 seconds', async () => {
  const ch = makeChannel();
  await sticky.setSticky(ch, { text: 'Hi' });
  for (let i = 0; i < 20; i++) { await sticky.onMessageForSticky(chat(ch, `b${i}`)); mock.timers.tick(1000); await flush(); }
  assert.ok(ch.sent.length >= 2, 'reposted despite nonstop chat');
  assert.equal(await sticky.removeSticky({ id: 'g1', channels: { fetch: async () => ch } }, 'c1'), true);
  assert.equal((await getSettings('g1')).stickies?.c1, undefined);
});

// ---------------------------------------------------------------- self roles

const roles = await import('../src/commands/roles.js');
const perms = (...p) => new PermissionsBitField(p.map((x) => PermissionFlagsBits[x]));
const R = (id, name, position, extra = {}) => ({ id, name, position, managed: false, permissions: perms(), unicodeEmoji: null, toString: () => `<@&${id}>`, ...extra });
const guild = {
  id: 'g1',
  roles: { cache: new Collection([
    ['eu', R('eu', 'Europe', 2, { unicodeEmoji: '🇪🇺' })], ['na', R('na', 'North America', 2)], ['ping', R('ping', 'Updates', 3)],
    ['mod', R('mod', 'Mod', 4, { permissions: perms('BanMembers') })], ['top', R('top', 'Owner', 99)], ['bot', R('bot', 'SomeBot', 1, { managed: true })],
  ]) },
  members: { me: { roles: { highest: { position: 10 } } } },
};
const held = new Set();
const member = {
  roles: { cache: { has: (id) => held.has(id) }, add: async (ids) => [].concat(ids).forEach((i) => held.add(i)), remove: async (ids) => [].concat(ids).forEach((i) => held.delete(i)) },
};
const ix = (extra = {}) => {
  const calls = [];
  const rec = async (p) => { calls.push(p); };
  return { calls, guild, member, user: { id: 'admin' }, memberPermissions: perms('ManageRoles'), reply: rec, update: rec, showModal: rec, ...extra };
};

test('dangerous, managed and too-high roles are blocked', () => {
  assert.equal(roles.blockReason(guild, guild.roles.cache.get('eu')), null);
  assert.match(roles.blockReason(guild, guild.roles.cache.get('mod')), /Ban Members/);
  assert.match(roles.blockReason(guild, guild.roles.cache.get('top')), /above the bot/);
  assert.match(roles.blockReason(guild, guild.roles.cache.get('bot')), /bot or integration/);
});

test('builder: pick roles, mode, style, text, then post', async () => {
  const start = ix();
  await roles.execute(start);
  json(start.calls[0]);
  assert.ok(start.calls[0].flags & 64);

  const pick = ix({ customId: 'roles:b:roles', values: ['eu', 'na', 'mod'] });
  await roles.handleSelect(pick);
  assert.match(textOf(pick.calls[0]), /<@&mod> can't be used: it has the Ban Members permission/);
  assert.ok(buttonLabels(pick.calls[0]).includes('Post here (2 roles)'));

  await roles.handleSelect(ix({ customId: 'roles:b:mode', values: ['o'] }));
  await roles.handleModal(ix({ customId: 'roles:b:textsave', fields: { getTextInputValue: (k) => (k === 'title' ? 'Your region' : 'Pick where you play from') } }));

  const posted = [];
  const post = ix({ customId: 'roles:b:post', channel: { send: async (m) => { posted.push(m); return {}; }, toString: () => '#roles' } });
  await roles.handleButton(post);
  json(posted[0]);
  assert.match(textOf(posted[0]), /## Your region\nPick where you play from/);
  assert.deepEqual(customIds(posted[0]), ['roles:t:o:eu', 'roles:t:o:na']);
  assert.match(textOf(post.calls[0]), /Posted!/);
});

test('buttons: click to add, click again to remove; "only one" swaps', async () => {
  const p = roles.panel(guild, { title: 'Regions', description: '', roles: ['eu', 'na'], mode: 'o', style: 'buttons' });
  const message = { components: p.components };
  await roles.handleButton(ix({ customId: 'roles:t:o:eu', message }));
  assert.deepEqual([...held], ['eu']);
  const swap = ix({ customId: 'roles:t:o:na', message });
  await roles.handleButton(swap);
  assert.deepEqual([...held], ['na']);
  assert.match(textOf(swap.calls[0]), /You got <@&na>!\n-# Removed <@&eu>/);
  await roles.handleButton(ix({ customId: 'roles:t:o:na', message }));
  assert.deepEqual([...held], []);

  const blocked = ix({ customId: 'roles:t:m:mod', message });
  await roles.handleButton(blocked);
  assert.match(textOf(blocked.calls[0]), /can't be given out/);
  assert.deepEqual([...held], []);
});

test('dropdown: your picks replace your roles from that list', async () => {
  const p = roles.panel(guild, { title: 'Pings', description: '', roles: ['eu', 'na', 'ping'], mode: 'm', style: 'menu' });
  json(p);
  const component = { options: p.components[0].toJSON().components.find((c) => c.type === 1).components[0].options };
  held.add('eu');
  const pick = ix({ customId: 'roles:s:m', values: ['na', 'ping'], component });
  await roles.handleSelect(pick);
  assert.deepEqual([...held].sort(), ['na', 'ping']);
  assert.match(textOf(pick.calls[0]), /➕ <@&na>\n➕ <@&ping>\n➖ <@&eu>/);
});

// ---------------------------------------------------------------- AFK

const { handleAfk } = await import('../src/lib/afk.js');
const { withAfk } = await import('../src/lib/nickname.js');

test('AFK tag works with the streak badge', () => {
  assert.equal(withAfk('Superman', true), '[AFK] Superman');
  assert.equal(withAfk('Superman [5🔥]', true), '[AFK] Superman [5🔥]');
  assert.equal(withAfk('[AFK] Superman [5🔥]', false), 'Superman [5🔥]');
  const long = withAfk(`${'A'.repeat(30)} [12🔥]`, true);
  assert.ok(long.length <= 32 && long.startsWith('[AFK] ') && long.endsWith('[12🔥]'));
});

const people = {};
const person = (id, nick) => {
  const m = {
    id, nickname: nick, displayName: nick, manageable: true, guild: { ownerId: 'owner' }, user: { globalName: nick, username: id },
    setNickname: async (n) => { m.nickname = n; m.displayName = n ?? nick; },
  };
  people[id] = m;
  return m;
};
person('sup', 'Superman'); person('bat', 'Batman');
const replies = [];
let mid = 0;
const say = (who, content, { mentions = [], replyTo = null } = {}) => ({
  id: `x${++mid}`, content, guildId: 'g1', channelId: 'gen', url: `https://discord.com/channels/g1/gen/x${mid}`,
  inGuild: () => true, member: people[who],
  guild: { members: { cache: new Map(Object.entries(people)) } },
  author: { id: who, bot: false, username: who, displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' },
  mentions: { users: new Collection(mentions.map((u) => [u, { id: u, bot: false }])), repliedUser: replyTo ? { id: replyTo, bot: false } : null },
  reply: async (m) => { replies.push(m); return { delete: async () => {} }; },
});

test('r!afk Too tired → tag, ping replies, welcome back with the pings', async () => {
  assert.equal(await handleAfk(say('sup', 'r!afk Too tired')), true);
  assert.equal(people.sup.nickname, '[AFK] Superman');
  assert.match(textOf(replies.at(-1)), /Superman is now AFK\n> Too tired/);
  json(replies.at(-1));

  await handleAfk(say('bat', 'hey <@sup> you there?', { mentions: ['sup'] }));
  assert.match(textOf(replies.at(-1)), /💤 \*\*Superman\*\* is AFK: Too tired/);
  assert.deepEqual(replies.at(-1).allowedMentions, { repliedUser: false });

  // pinged again right away: recorded, but no second reply (cooldown)
  const before = replies.length;
  await handleAfk(say('bat', 'hello??', { replyTo: 'sup' }));
  assert.equal(replies.length, before);

  mock.timers.tick(2 * 3600_000);
  await handleAfk(say('sup', 'I\'m back'));
  assert.equal(people.sup.nickname, null); // back to their normal name
  const welcome = replies.at(-1);
  json(welcome);
  assert.match(textOf(welcome), /Welcome back, Superman!/);
  assert.match(textOf(welcome), /\*\*2\*\* pings while you were away/);
  assert.match(textOf(welcome), /<@bat> in <#gen> · \[jump\]/);

  // not AFK anymore: pinging them does nothing
  const n = replies.length;
  await handleAfk(say('bat', '<@sup>', { mentions: ['sup'] }));
  assert.equal(replies.length, n);
});

test('r!afk without a reason, and @everyone in a reason is defused', async () => {
  await handleAfk(say('bat', 'r!afk'));
  assert.match(textOf(replies.at(-1)), /> AFK/);
  await handleAfk(say('bat', 'r!afk @everyone lol'));
  assert.match(textOf(replies.at(-1)), /@​everyone lol/);
});
