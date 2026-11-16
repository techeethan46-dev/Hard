import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
mock.timers.enable({ apis: ['setTimeout'] }); // warning cleanups etc. shouldn't keep the test running

const { initStore } = await import('../src/lib/store.js');
await initStore({ jsonPath: null });
const { updateSettings, getSettings } = await import('../src/lib/settings.js');
await updateSettings('g1', { modLogChannel: 'modlog', serverLogChannel: 'serverlog', bannedWords: ['badword'], automodExemptRoles: ['trusted'] });
const automod = await import('../src/lib/automod.js');
const { detect, SpamTracker, isScamDomain } = automod;

// ---------------------------------------------------------------- rules

test('detects invites, scams and look-alike domains, but not real sites', () => {
  const rule = (c, o) => detect(c, o)?.rule ?? null;
  assert.equal(rule('join discord.gg/abc'), 'invites');
  assert.equal(rule('https://discord.com/invite/xyz'), 'invites');
  for (const d of ['dlscord.gift', 'roblox.com.ge', 'rob1ox.com', 'free-robux-roblox.xyz', 'steamcommunlty.com']) assert.ok(isScamDomain(d), d);
  for (const d of ['roblox.com', 'www.roblox.com', 'roblox.fandom.com', 'robloxden.com', 'discord.gift', 'discord.js.org', 'team.com']) {
    assert.ok(!isScamDomain(d.replace(/^www\./, '')), d);
  }
  assert.equal(rule('free nitro here https://example.com'), 'scams');
  assert.equal(rule('free nitro would be nice'), null); // no link, just chatting
  assert.equal(rule('check https://www.roblox.com/games/1'), null);
});

test('blocked words catch disguises but not longer words', () => {
  const o = { words: ['badword', 'two words'] };
  assert.equal(detect('you b4dw0rd', o)?.rule, 'words');
  assert.equal(detect('BADWORD!', o)?.rule, 'words');
  assert.equal(detect('what the b@dw0rd', o)?.rule, 'words');
  assert.equal(detect('sh!t', { words: ['shit'] })?.rule, 'words');
  assert.equal(detect('badwordy is fine', o), null);
  assert.equal(detect('these are two   words', o), null); // spacing differs: only exact phrases
  assert.equal(detect('these are two words', o)?.rule, 'words');
});

test('mentions, links and caps', () => {
  assert.equal(detect('hi', { mentions: 5 })?.rule, 'mentions');
  assert.equal(detect('hi', { mentions: 4 }), null);
  assert.equal(detect('see https://example.com', { filters: ['links'] })?.rule, 'links');
  assert.equal(detect('see https://example.com'), null); // links filter is off by default
  assert.equal(detect('THIS IS SO COOL WOW AMAZING', { filters: ['caps'] })?.rule, 'caps');
  assert.equal(detect('OK LOL', { filters: ['caps'] }), null);
});

test('spam: too fast, or the same message 3 times', () => {
  const t = new SpamTracker();
  let hit;
  for (let i = 0; i < 6; i++) hit = t.add('k', { id: `m${i}`, text: `msg ${i}`, at: 1000 + i * 500 });
  assert.equal(hit.reason, 'Sending messages too fast');
  assert.equal(hit.ids.length, 6);
  const r = new SpamTracker();
  r.add('k', { id: 'a', text: 'buy my stuff', at: 0 });
  assert.equal(r.add('k', { id: 'b', text: 'BUY MY STUFF', at: 8000 }), null);
  assert.equal(r.add('k', { id: 'c', text: 'buy my stuff', at: 16000 }).reason, 'Repeating the same message');
});

// ---------------------------------------------------------------- acting on messages

const ALL = new PermissionsBitField(PermissionsBitField.All);
const logs = { modlog: [], serverlog: [] };
const chan = (id) => ({ id, name: id, isTextBased: () => true, toString: () => `<#${id}>`, send: async (m) => { logs[id]?.push(m); return { delete: async () => {}, edit: async (e) => { logs[id]?.push(e); } }; } });
const guild = {
  id: 'g1', name: 'Cool Server', memberCount: 100, iconURL: () => null,
  channels: { fetch: async (id) => chan(id) },
};
const user = (id, extra = {}) => ({ id, bot: false, tag: `${id}#0`, username: id, toString: () => `<@${id}>`, displayAvatarURL: () => 'https://cdn.discordapp.com/a.png', createdTimestamp: Date.now() - 400 * 86_400_000, ...extra });
const member = (id, { staff = false, roles = [] } = {}) => {
  const m = {
    id, user: user(id), guild, moderatable: true, timedOut: 0,
    permissions: new PermissionsBitField(staff ? PermissionFlagsBits.ManageMessages : 0n),
    roles: { cache: new Map(roles.map((r) => [r, { id: r }])) },
    timeout: async (ms) => { m.timedOut = ms; },
  };
  return m;
};
const channel = { ...chan('general'), sent: [], bulk: [] };
channel.send = async (m) => { channel.sent.push(m); return { delete: async () => {} }; };
channel.bulkDelete = async (ids) => { channel.bulk.push(ids); };
let n = 0;
const message = (content, m, extra = {}) => {
  const msg = {
    id: `msg${++n}`, content, guildId: 'g1', guild, channel, channelId: 'general', member: m, author: m.user, deleted: false,
    inGuild: () => true, mentions: { users: { size: 0 }, roles: { size: 0 } },
    delete: async () => { msg.deleted = true; },
    ...extra,
  };
  return msg;
};

test('AutoMod deletes, warns, logs, and times out on the 3rd hit', async () => {
  const bob = member('bob');
  const m1 = message('come to discord.gg/other', bob);
  assert.equal(await automod.moderate(m1), true);
  assert.ok(m1.deleted);
  assert.match(textOf(channel.sent.at(-1)), /<@bob>, discord invite links aren't allowed/);
  const log = logs.modlog.at(-1);
  json(log);
  assert.match(textOf(log), /AutoMod · Discord invites/);
  assert.match(textOf(log), /discord\.gg\/other/);
  assert.ok(automod.deletedByAutomod.has(m1.id));

  await automod.moderate(message('b4dw0rd', bob));
  assert.equal(bob.timedOut, 0);
  await automod.moderate(message('discord.gg/again', bob));
  assert.equal(bob.timedOut, 10 * 60_000);
  assert.match(textOf(logs.modlog.at(-1)), /timed out for 10 minutes/);
});

test('staff and exempt roles are never filtered; normal messages pass', async () => {
  assert.equal(await automod.moderate(message('discord.gg/x', member('mod', { staff: true }))), false);
  assert.equal(await automod.moderate(message('discord.gg/x', member('vip', { roles: ['trusted'] }))), false);
  assert.equal(await automod.moderate(message('hello everyone!', member('amy'))), false);
});

test('spam burst is bulk-deleted and timed out', async () => {
  const sam = member('sam');
  for (let i = 0; i < 6; i++) await automod.moderate(message(`spam ${i}`, sam));
  assert.equal(channel.bulk.at(-1).length, 6);
  assert.equal(sam.timedOut, 5 * 60_000);
});

test('turning filters off in setup turns AutoMod off', async () => {
  await updateSettings('g1', { automodFilters: [] });
  assert.equal(await automod.moderate(message('discord.gg/x', member('zed'))), false);
  await updateSettings('g1', { automodFilters: null });
});

// ---------------------------------------------------------------- raid protection

const raid = await import('../src/lib/raid.js');
const joiner = (id, ageDays) => {
  const m = member(id);
  m.user = user(id, { createdTimestamp: Date.now() - ageDays * 86_400_000 });
  m.guild = guild;
  m.kicked = false;
  m.dms = [];
  m.send = async (x) => { m.dms.push(x); };
  m.kick = async () => { m.kicked = true; };
  return m;
};

test('minimum account age kicks brand-new accounts with a DM', async () => {
  await updateSettings('g1', { minAccountAge: '7' });
  const young = joiner('young', 2);
  assert.equal(await raid.screenJoin(young), true);
  assert.ok(young.kicked);
  assert.match(textOf(young.dms[0]), /at least \*\*7 days\*\* old/);
  const old = joiner('old', 30);
  assert.equal(await raid.screenJoin(old), false);
  await updateSettings('g1', { minAccountAge: null });
});

test('a join burst starts raid mode: new accounts kicked, old ones kept, staff alerted', async () => {
  await updateSettings('g1', { raidProtection: 'strict' });
  const now = Date.now();
  const people = [joiner('a', 1), joiner('b', 400), joiner('c', 3), joiner('d', 5), joiner('e', 2)];
  for (const [i, p] of people.entries()) await raid.screenJoin(p, now + i * 1000);
  assert.equal(raid.raidStatus('g1').active, true);
  assert.deepEqual(people.map((p) => p.kicked), [true, false, true, true, true]);
  const alert = logs.modlog.at(-1);
  json(alert);
  assert.match(textOf(alert), /Raid mode is ON/);
  assert.deepEqual(customIds(alert), ['raidmode:end']);

  // during raid mode: new accounts kicked, old accounts fine
  const late = joiner('late', 1);
  assert.equal(await raid.screenJoin(late), true);
  assert.equal(await raid.screenJoin(joiner('vet', 900)), false);

  assert.equal(await raid.endRaid(guild, { by: '<@mod>' }), true);
  assert.match(textOf(logs.modlog.at(-1)), /Raid mode ended/);
  assert.match(textOf(logs.modlog.at(-1)), /\*\*5\*\* new accounts kicked/);
  assert.equal(raid.raidStatus('g1').active, false);
});

test('raid protection off never triggers', async () => {
  await updateSettings('g1', { raidProtection: 'off' });
  for (let i = 0; i < 20; i++) await raid.screenJoin(joiner(`x${i}`, 1));
  assert.equal(raid.raidStatus('g1').active, false);
});

// ---------------------------------------------------------------- server logs

const slog = await import('../src/lib/serverlog.js');

test('message delete / edit / bulk logs', async () => {
  const before = logs.serverlog.length;
  const amy = member('amy');
  await slog.messageDeleted({ ...message('oops secret', amy), createdTimestamp: Date.now() - 60_000, attachments: new Collection([['1', { name: 'pic.png' }]]) });
  const del = logs.serverlog.at(-1);
  json(del);
  assert.match(textOf(del), /Message deleted/);
  assert.match(textOf(del), /> oops secret/);
  assert.match(textOf(del), /📎 pic\.png/);

  // AutoMod's own deletions aren't logged twice
  const auto = message('x', amy);
  automod.deletedByAutomod.add(auto.id);
  await slog.messageDeleted(auto);
  assert.equal(logs.serverlog.length, before + 1);

  await slog.messageEdited({ content: 'helo' }, { ...message('hello', amy), url: 'https://discord.com/channels/1/2/3' });
  const edit = logs.serverlog.at(-1);
  json(edit);
  assert.match(textOf(edit), /\*\*Before\*\*\n> helo/);
  assert.match(textOf(edit), /\*\*After\*\*\n> hello/);

  const msgs = new Collection([['1', { content: 'a', createdTimestamp: 1, createdAt: new Date(1), author: { tag: 'x#0' } }], ['2', { content: 'b', createdTimestamp: 2, createdAt: new Date(2), author: { tag: 'y#0' } }]]);
  await slog.messagesBulkDeleted(msgs, { ...chan('general'), guild });
  const bulk = logs.serverlog.at(-1);
  assert.match(textOf(bulk), /\*\*2\*\* messages removed/);
  assert.match(bulk.files[0].attachment.toString(), /x#0: a\n.*y#0: b/);
  json(bulk);
});

test('member logs: join, leave, nickname (ignoring 🔥 badge), roles, timeout, ban', async () => {
  const mk = (nick, roleIds, until = null) => ({
    partial: false, guild, user: user('amy'), nickname: nick, toString: () => '<@amy>',
    roles: { cache: new Collection(roleIds.map((r) => [r, { id: r, toString: () => `<@&${r}>` }])) },
    communicationDisabledUntilTimestamp: until,
  });
  const count = () => logs.serverlog.length;

  let c = count();
  await slog.memberUpdated(mk('Amy [3🔥]', []), mk('Amy [4🔥]', []));
  assert.equal(count(), c, 'streak badge change is not logged');

  await slog.memberUpdated(mk('Amy', []), mk('Queen Amy', []));
  assert.match(textOf(logs.serverlog.at(-1)), /Nickname changed[\s\S]*Before\*\* Amy[\s\S]*After\*\* Queen Amy/);

  await slog.memberUpdated(mk(null, ['r1']), mk(null, ['r2']));
  assert.match(textOf(logs.serverlog.at(-1)), /➕ <@&r2>\n➖ <@&r1>/);

  await slog.memberUpdated(mk(null, []), mk(null, [], Date.now() + 60_000));
  assert.match(textOf(logs.serverlog.at(-1)), /Timed out/);

  const newbie = joiner('newbie', 2);
  newbie.toString = () => '<@newbie>';
  await slog.memberJoined(newbie);
  assert.match(textOf(logs.serverlog.at(-1)), /new account/);

  await slog.memberLeft({ ...mk(null, ['r1']), joinedTimestamp: Date.now() - 86_400_000 });
  assert.match(textOf(logs.serverlog.at(-1)), /Member left[\s\S]*<@&r1>/);

  await slog.memberBanned({ guild, user: user('bad'), reason: 'Exploiting' });
  assert.match(textOf(logs.serverlog.at(-1)), /banned[\s\S]*Exploiting/);
  logs.serverlog.slice(c).forEach((m) => json(m));
});

// ---------------------------------------------------------------- setup

test('setup: Safety steps', async () => {
  const setup = await import('../src/commands/setup.js');
  const g = {
    ...guild, roles: { cache: new Map() }, channels: { cache: new Map() },
    members: { me: { roles: { highest: { position: 10 } }, permissions: ALL } },
  };
  const step = (key) => setup.STEPS.findIndex((s) => s.key === key);
  const ix = (customId, extra = {}) => {
    const calls = [];
    return { calls, customId, guild: g, guildId: 'g1', memberPermissions: ALL, update: async (p) => calls.push(p), showModal: async (p) => calls.push(p), ...extra };
  };

  const filters = await setup.render(g, step('automodFilters'));
  json(filters);
  assert.match(textOf(filters), /using the default: Spam & flooding, Discord invites/);
  await setup.handleSelect(ix(`setup:set:${step('automodFilters')}`, { values: ['spam', 'caps'] }));
  assert.deepEqual((await getSettings('g1')).automodFilters, ['spam', 'caps']);
  await setup.handleSelect(ix(`setup:set:${step('automodFilters')}`, { values: [] }));
  assert.match(textOf(await setup.render(g, step('automodFilters'))), /All off/);

  await setup.handleModal(ix(`setup:wordsave:${step('bannedWords')}`, { fields: { getTextInputValue: () => 'Foo, bar\nfoo, , baz' } }));
  assert.deepEqual((await getSettings('g1')).bannedWords, ['foo', 'bar', 'baz']);
  assert.match(textOf(await setup.render(g, step('bannedWords'))), /3 words · \|\|foo, bar, baz\|\|/);

  await setup.handleSelect(ix(`setup:set:${step('raidProtection')}`, { values: ['strict'] }));
  assert.match(textOf(await setup.render(g, step('raidProtection'))), /✅ Strict/);
  json(await setup.render(g, setup.STEPS.length)); // summary still valid with all sections
});
