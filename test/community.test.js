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
  return { calls, guild, member, user: { id: 'admin' }, memberPermissions: perms('ManageRoles'), reply: rec, update: rec, showModal: rec, editReply: rec, deferUpdate: async () => {}, ...extra };
};

test('dangerous, managed and too-high roles are blocked', () => {
  assert.equal(roles.blockReason(guild, guild.roles.cache.get('eu')), null);
  assert.match(roles.blockReason(guild, guild.roles.cache.get('mod')), /Ban Members/);
  assert.match(roles.blockReason(guild, guild.roles.cache.get('top')), /above the bot/);
  assert.match(roles.blockReason(guild, guild.roles.cache.get('bot')), /bot or integration/);
});

test('builder: pick roles, mode, style, text, then post (buttons)', async () => {
  const start = ix();
  await roles.execute(start);
  json(start.calls[0]);
  assert.ok(start.calls[0].flags & 64);
  assert.match(textOf(start.calls[0]), /2 · Choose how it works/);

  const pick = ix({ customId: 'roles:b:roles', values: ['eu', 'na', 'mod'] });
  await roles.handleSelect(pick);
  assert.match(textOf(pick.calls[0]), /<@&mod> can't be used: it has the Ban Members permission/);
  assert.ok(buttonLabels(pick.calls[0]).includes('Post here (2 roles)'));

  await roles.handleSelect(ix({ customId: 'roles:b:mode', values: ['o'] }));
  const style = ix({ customId: 'roles:b:style', values: ['buttons'] });
  await roles.handleSelect(style);
  assert.match(textOf(style.calls[0]), /Click a button to get a role/); // the default text follows the style
  await roles.handleModal(ix({ customId: 'roles:b:textsave', fields: { getTextInputValue: (k) => (k === 'title' ? 'Your region' : 'Pick where you play from') } }));

  const posted = [];
  const post = ix({ customId: 'roles:b:post', channel: { send: async (m) => { posted.push(m); return {}; }, toString: () => '#roles' } });
  await roles.handleButton(post);
  json(posted[0]);
  assert.match(textOf(posted[0]), /## Your region\nPick where you play from/);
  assert.deepEqual(customIds(posted[0]), ['roles:t:o:eu', 'roles:t:o:na']);
  assert.match(textOf(post.calls[0]), /Posted!/);
});

// ---------------------------------------------------------------- reaction roles

const RR = await import('../src/lib/reactionroles.js');

test('emojis: parsing, and every role gets its own', () => {
  assert.equal(RR.parseEmoji('🎮').key, '🎮');
  assert.equal(RR.parseEmoji('❤️').key, '❤');
  assert.equal(RR.parseEmoji('🇪🇺').key, '🇪🇺');
  assert.equal(RR.parseEmoji('<:wobble:123456789012345678>').key, '123456789012345678');
  assert.equal(RR.parseEmoji('1️⃣').key, '1⃣');
  assert.ok(RR.parseEmoji('👨‍👩‍👧'), 'joined emoji count as one');
  assert.ok(RR.parseEmoji('👍🏽'), 'skin tones too');
  for (const bad of ['', 'abc', 'a🎮', '🎮🎮', '🎮 🎮', ':smile:', '🎮x']) assert.equal(RR.parseEmoji(bad), null, bad);
  assert.equal(RR.reactionKey({ id: null, name: '❤️' }), '❤');
  assert.equal(RR.reactionKey({ id: '99', name: 'wobble' }), '99');

  const out = RR.assignEmojis(guild, ['eu', 'na', 'ping'], { ping: '🔔' });
  assert.equal(out.eu, '🇪🇺'); // the role's own emoji
  assert.equal(out.ping, '🔔'); // kept
  assert.ok(out.na && out.na !== '🔔' && out.na !== '🇪🇺'); // from the palette, not a duplicate
  assert.equal(new Set(Object.values(out)).size, 3);
});

function fakeSent() {
  const sent = { id: 'panel1', reacted: [], edits: [], failOn: null };
  sent.react = async (e) => { if (e === sent.failOn) throw new Error('Unknown Emoji'); sent.reacted.push(e); };
  sent.edit = async (m) => { sent.edits.push(m); };
  return sent;
}

test('reaction builder: emojis are listed, can be changed, and bad ones are refused', async () => {
  await roles.execute(ix());
  const pick = ix({ customId: 'roles:b:roles', values: ['eu', 'na'] });
  await roles.handleSelect(pick);
  json(pick.calls[0]);
  const t = textOf(pick.calls[0]);
  assert.match(t, /😀 Emojis\n🇪🇺 {2}· {2}<@&eu>\n\S+ {2}· {2}<@&na>/);
  assert.match(t, /React to this message to get a role/);
  assert.ok(customIds(pick.calls[0]).includes('roles:b:emojipick'));

  const ask = ix({ customId: 'roles:b:emojipick', values: ['na'] });
  await roles.handleSelect(ask);
  assert.match(ask.calls[0].toJSON().custom_id, /^roles:b:emoji:na$/);

  const set = (emoji) => ix({ customId: 'roles:b:emoji:na', fields: { getTextInputValue: () => emoji } });
  const bad = set('hello');
  await roles.handleModal(bad);
  assert.match(textOf(bad.calls[0]), /That isn't an emoji/);
  const dupe = set('🇪🇺');
  await roles.handleModal(dupe);
  assert.match(textOf(dupe.calls[0]), /already used for <@&eu>/);
  const ok = set('🎮');
  await roles.handleModal(ok);
  assert.match(textOf(ok.calls[0]), /🎮 {2}· {2}<@&na>/);
});

test('posting a reaction panel adds the reactions and saves it', async () => {
  const sent = fakeSent();
  const posted = [];
  const channel = { send: async (m) => { posted.push(m); return sent; }, toString: () => '#roles' };
  await roles.handleSelect(ix({ customId: 'roles:b:mode', values: ['o'] }));
  const post = ix({ customId: 'roles:b:post', channel });
  await roles.handleButton(post);

  json(posted[0]);
  assert.match(textOf(posted[0]), /React to this message to get a role[\s\S]*🇪🇺 {2}· {2}<@&eu>\n🎮 {2}· {2}<@&na>[\s\S]*one of these at a time/);
  assert.deepEqual(sent.reacted, ['🇪🇺', '🎮']);
  assert.match(textOf(post.calls[0]), /Posted!/);
  const saved = (await getSettings('g1')).reactionPanels.panel1;
  assert.deepEqual(saved, { mode: 'o', roles: [{ roleId: 'eu', emoji: '🇪🇺' }, { roleId: 'na', emoji: '🎮' }] });
});

test('an emoji Discord refuses is left out and the panel is corrected', async () => {
  await roles.execute(ix());
  await roles.handleSelect(ix({ customId: 'roles:b:roles', values: ['eu', 'na'] }));
  const sent = fakeSent();
  sent.id = 'panel2';
  sent.failOn = '🇪🇺';
  const post = ix({ customId: 'roles:b:post', channel: { send: async () => sent, toString: () => '#roles' } });
  await roles.handleButton(post);
  assert.match(textOf(post.calls[0]), /couldn't use 🇪🇺/);
  assert.equal(sent.edits.length, 1);
  assert.doesNotMatch(textOf(sent.edits[0]), /🇪🇺/);
  assert.deepEqual((await getSettings('g1')).reactionPanels.panel2.roles.map((r) => r.roleId), ['na']);
});

function reactionOn(emoji, { removed = [] } = {}) {
  const cache = new Map([['x', { emoji: { id: null, name: '🇪🇺' }, users: { remove: async (id) => removed.push(['🇪🇺', id]) } }],
    ['y', { emoji: { id: null, name: '🎮' }, users: { remove: async (id) => removed.push(['🎮', id]) } }]]);
  return {
    partial: false, emoji: { id: null, name: emoji }, users: { remove: async (id) => removed.push([emoji, id]) },
    message: { id: 'panel1', guild: { ...guild, id: 'g1' }, reactions: { cache } },
  };
}

test('reacting gives the role, un-reacting takes it, and "only one" swaps', async () => {
  guild.members.fetch = async () => member;
  held.clear();
  const u = { id: 'u1', bot: false };

  await RR.handleReaction(reactionOn('🇪🇺'), u, true);
  assert.deepEqual([...held], ['eu']);

  const removed = [];
  await RR.handleReaction(reactionOn('🎮', { removed }), u, true); // panel1 is "only one at a time"
  assert.deepEqual([...held], ['na']);
  assert.deepEqual(removed, [['🇪🇺', 'u1']], 'their old reaction is taken off too');

  await RR.handleReaction(reactionOn('🎮'), u, false);
  assert.deepEqual([...held], []);
});

test('reaction roles ignore bots and other emojis, and refuse blocked roles', async () => {
  held.clear();
  await RR.handleReaction(reactionOn('🇪🇺'), { id: 'bot', bot: true }, true);
  assert.deepEqual([...held], []);

  const removed = [];
  await RR.handleReaction(reactionOn('🍕', { removed }), { id: 'u1', bot: false }, true);
  assert.deepEqual(removed, [['🍕', 'u1']], 'foreign emojis are cleaned off the panel');
  assert.deepEqual([...held], []);

  // a role that became dangerous after the panel was posted
  await RR.savePanel('g1', 'panel9', { mode: 'm', roles: [{ roleId: 'mod', emoji: '🛡️' }] });
  const r = reactionOn('🛡️', { removed });
  r.message.id = 'panel9';
  await RR.handleReaction(r, { id: 'u1', bot: false }, true);
  assert.deepEqual([...held], []);
  assert.deepEqual(removed.at(-1), ['🛡️', 'u1']);

  // a message that isn't a role panel does nothing
  const other = reactionOn('🇪🇺');
  other.message.id = 'random';
  await RR.handleReaction(other, { id: 'u1', bot: false }, true);
  assert.deepEqual([...held], []);

  await RR.forgetPanel('g1', 'panel9');
  assert.equal((await getSettings('g1')).reactionPanels.panel9, undefined);
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
