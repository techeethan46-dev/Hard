import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
mock.timers.enable({ apis: ['setTimeout'] }); // warning cleanups etc. shouldn't keep the test running

const { initStore } = await import('../src/lib/store.js');
await initStore({ jsonPath: null });
const { updateSettings, getSettings } = await import('../src/lib/settings.js');
await updateSettings('g1', { modLogChannel: 'modlog', serverLogChannel: 'serverlog', joinLogChannel: 'joinlog', leaveLogChannel: 'leavelog', bannedWords: ['badword'], automodExemptRoles: ['trusted'] });
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
const logs = { modlog: [], serverlog: [], joinlog: [], leavelog: [] };
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

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
guild.roles = { cache: new Collection([['r2', { id: 'r2', name: 'Members' }], ['r3', { id: 'r3', name: 'VIP' }]]) };
guild.audit = [];
guild.fetchAuditLogs = async ({ type }) => ({ entries: new Collection(guild.audit.filter((e) => e.type === type).map((e, i) => [i, e])) });
guild.bans = { fetch: async () => { throw new Error('Unknown Ban'); } };
const { AuditLogEvent } = await import('discord.js');
const person = (id, extra = {}) => ({ ...user(id), globalName: id[0].toUpperCase() + id.slice(1), ...extra });
const wait = async (ms) => { mock.timers.tick(ms); await flush(); };
const lastIn = (name) => textOf(logs[name].at(-1));
const last = () => lastIn('serverlog');

test('leaves go to the leave log; kicks, bans and unbans go to the mod log', async () => {
  const gone = (u) => ({ guild, user: u, joinedTimestamp: Date.now() - 4 * 86_400_000, roles: { cache: new Collection([['r2', guild.roles.cache.get('r2')]]) } });
  const counts = () => Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, v.length]));
  const wasOnly = (before, name, extra = 1) => {
    const now = counts();
    for (const k of Object.keys(now)) assert.equal(now[k], before[k] + (k === name ? extra : 0), `${k} log`);
  };

  // just left: no audit entry -> leave log only
  let before = counts();
  let p = slog.memberLeft(gone(person('amy')));
  await wait(slog.AUDIT_DELAY_MS);
  await p;
  wasOnly(before, 'leavelog');
  assert.match(lastIn('leavelog'), /📤 Member left\n\*\*Amy\*\* · `amy#0`/);
  assert.match(lastIn('leavelog'), /\*\*Joined\*\* .*\n\*\*Roles\*\* <@&r2>/);
  json(logs.leavelog.at(-1));

  // a bot with no audit entry -> leave log
  p = slog.memberLeft(gone(person('arcane', { bot: true })));
  await wait(slog.AUDIT_DELAY_MS);
  await p;
  assert.match(lastIn('leavelog'), /🤖 Bot removed/);

  // kicked: the audit log says who and why -> mod log only
  guild.audit.push({ type: AuditLogEvent.MemberKick, target: { id: 'bloxlink' }, executor: person('mod'), reason: 'No longer needed', createdTimestamp: Date.now() });
  before = counts();
  p = slog.memberLeft(gone(person('bloxlink', { bot: true })));
  await wait(slog.AUDIT_DELAY_MS);
  await p;
  wasOnly(before, 'modlog');
  assert.match(lastIn('modlog'), /👢 Bot kicked/);
  assert.match(lastIn('modlog'), /\*\*Kicked by\*\* \*\*Mod\*\*\n\*\*Reason\*\* No longer needed/);

  // banned: ban event first, then the leave event: ONE message, in the mod log
  guild.audit.push({ type: AuditLogEvent.MemberBanAdd, target: { id: 'raider' }, executor: person('mod'), reason: null, createdTimestamp: Date.now() });
  before = counts();
  const b = slog.memberBanned({ guild, user: person('raider'), reason: 'Raiding', partial: false });
  const l = slog.memberLeft(gone(person('raider')));
  await wait(slog.AUDIT_DELAY_MS);
  await Promise.all([b, l]);
  wasOnly(before, 'modlog');
  assert.match(lastIn('modlog'), /🔨 Member banned/);
  assert.match(lastIn('modlog'), /\*\*Banned by\*\* \*\*Mod\*\*\n\*\*Reason\*\* Raiding/);
  json(logs.modlog.at(-1));

  // banned: the leave event is noticed first and finds the ban itself, then the ban event stays quiet
  guild.bans.fetch = async () => ({ reason: 'Scamming' });
  before = counts();
  const l2 = slog.memberLeft(gone(person('scammer')));
  await wait(slog.AUDIT_DELAY_MS);
  await l2;
  const b2 = slog.memberBanned({ guild, user: person('scammer'), reason: 'Scamming', partial: false });
  await wait(slog.AUDIT_DELAY_MS);
  await b2;
  wasOnly(before, 'modlog');
  assert.match(lastIn('modlog'), /🔨 Member banned[\s\S]*Scamming/);
  guild.bans.fetch = async () => { throw new Error('Unknown Ban'); };

  // unban -> mod log
  before = counts();
  await slog.memberUnbanned({ guild, user: person('raider') });
  wasOnly(before, 'modlog');
  assert.match(lastIn('modlog'), /🕊️ Member unbanned/);
});

test('a kick or ban done with /kick or /ban is not logged a second time', async () => {
  const { modLog } = await import('../src/lib/ui.js');
  const gone = (u) => ({ guild, user: u, joinedTimestamp: Date.now(), roles: { cache: new Collection() } });
  const count = () => logs.modlog.length;

  // /kick: the command logs it (that's the 1 message), then the kick event arrives
  guild.audit.push({ type: AuditLogEvent.MemberKick, target: { id: 'k1' }, executor: person('botself'), reason: 'mod#0: spamming', createdTimestamp: Date.now() });
  let n = count();
  await modLog(guild, { action: 'Kick', target: person('k1'), moderator: person('mod'), reason: 'spamming' });
  let p = slog.memberLeft(gone(person('k1')));
  await wait(slog.AUDIT_DELAY_MS);
  await p;
  assert.equal(count(), n + 1);

  // /ban: same
  guild.audit.push({ type: AuditLogEvent.MemberBanAdd, target: { id: 'b1' }, executor: person('botself'), reason: 'mod#0: scam', createdTimestamp: Date.now() });
  n = count();
  await modLog(guild, { action: 'Ban', target: person('b1'), moderator: person('mod'), reason: 'scam' });
  const b = slog.memberBanned({ guild, user: person('b1'), reason: 'mod#0: scam', partial: false });
  p = slog.memberLeft(gone(person('b1')));
  await wait(slog.AUDIT_DELAY_MS);
  await Promise.all([b, p]);
  assert.equal(count(), n + 1);

  // the bot's own raid-protection kicks are summed up by the raid alert, not logged one by one
  guild.members = { me: { id: 'botself' } };
  guild.audit.push({ type: AuditLogEvent.MemberKick, target: { id: 'r1' }, executor: person('botself'), reason: 'Raid protection', createdTimestamp: Date.now() });
  n = count();
  const leaves = logs.leavelog.length;
  p = slog.memberLeft(gone(person('r1')));
  await wait(slog.AUDIT_DELAY_MS);
  await p;
  assert.equal(count(), n);
  assert.equal(logs.leavelog.length, leaves);
  delete guild.members;
});

test('role changes for one person become ONE message, written in words', async () => {
  const roleObj = (id, name) => ({ id, name });
  const mk = (id, roleList, nick = null) => ({
    partial: false, guild, id, user: person(id), nickname: nick,
    roles: { cache: new Collection(roleList.map((r) => [r.id, r])) }, communicationDisabledUntilTimestamp: null,
  });
  const gone = roleObj('r1', 'Old Role'); // not in the server anymore
  const members = guild.roles.cache.get('r2');
  const vip = guild.roles.cache.get('r3');
  const n = logs.serverlog.length;

  // three quick changes for Amy, one for Bob
  guild.audit.push({ type: AuditLogEvent.MemberRoleUpdate, target: { id: 'amy' }, executor: person('mod'), createdTimestamp: Date.now() });
  await slog.memberUpdated(mk('amy', [gone]), mk('amy', [members]));
  await slog.memberUpdated(mk('amy', [members]), mk('amy', [members, vip]));
  await slog.memberUpdated(mk('bob', []), mk('bob', [vip]));
  await flush();
  assert.equal(logs.serverlog.length, n, 'nothing posted until the burst is over');

  await wait(slog.ROLE_BATCH_MS);
  assert.equal(logs.serverlog.length, n + 2);
  const [amy, bob] = logs.serverlog.slice(-2).map(textOf);
  assert.match(amy, /🎭 Roles changed\n\*\*Amy\*\* · `amy#0`\n\*\*Roles added\*\* <@&r2> <@&r3>\n\*\*Roles removed\*\* \*\*Old Role\*\*\n\*\*Changed by\*\* \*\*Mod\*\*/);
  assert.doesNotMatch(amy, /➕|➖/);
  assert.match(bob, /\*\*Bob\*\* · `bob#0`\n\*\*Roles added\*\* <@&r3>/);
  logs.serverlog.slice(-2).forEach((m) => json(m));

  // a role added and taken away again inside the burst cancels out: no message
  const m0 = logs.serverlog.length;
  await slog.memberUpdated(mk('cat', []), mk('cat', [vip]));
  await slog.memberUpdated(mk('cat', [vip]), mk('cat', []));
  await wait(slog.ROLE_BATCH_MS);
  assert.equal(logs.serverlog.length, m0);

  // later changes are a new message
  await slog.memberUpdated(mk('amy', [members]), mk('amy', []));
  await wait(slog.ROLE_BATCH_MS);
  assert.match(last(), /\*\*Roles removed\*\* <@&r2>/);
});

test('member logs: join, nickname (ignoring 🔥 badge and AFK tag), timeout, unban', async () => {
  const mk = (nick, until = null) => ({
    partial: false, guild, user: person('amy'), nickname: nick, toString: () => '<@amy>',
    roles: { cache: new Collection() }, communicationDisabledUntilTimestamp: until,
  });
  const count = () => logs.serverlog.length;

  let c = count();
  await slog.memberUpdated(mk('Amy [3🔥]'), mk('Amy [4🔥]'));
  await slog.memberUpdated(mk('Amy'), mk('[AFK] Amy'));
  await slog.memberUpdated(mk('[AFK] Amy [4🔥]'), mk('Amy [4🔥]'));
  assert.equal(count(), c, 'streak badge and AFK tag changes are not logged');

  await slog.memberUpdated(mk('Amy'), mk('Queen Amy'));
  assert.match(last(), /Nickname changed[\s\S]*Before\*\* Amy[\s\S]*After\*\* Queen Amy/);

  await slog.memberUpdated(mk(null), mk(null, Date.now() + 60_000));
  assert.match(last(), /Timed out/);

  logs.serverlog.slice(c).forEach((m) => json(m));
});

test('joins go to the join log, not the server log', async () => {
  const joins = logs.joinlog.length;
  const server = logs.serverlog.length;
  const newbie = joiner('newbie', 2);
  newbie.user.globalName = 'Newbie';
  await slog.memberJoined(newbie);
  assert.equal(logs.joinlog.length, joins + 1);
  assert.equal(logs.serverlog.length, server);
  assert.match(lastIn('joinlog'), /📥 Member joined\n\*\*Newbie\*\*[\s\S]*new account/);
  const botJoin = joiner('helper', 900);
  botJoin.user.bot = true;
  await slog.memberJoined(botJoin);
  assert.match(lastIn('joinlog'), /🤖 Bot added/);
  assert.doesNotMatch(lastIn('joinlog'), /new account/);
  logs.joinlog.slice(joins).forEach((m) => json(m));
});

test('a join or leave channel that isn\'t set falls back to the server log', async () => {
  await updateSettings('g1', { joinLogChannel: null, leaveLogChannel: null, modLogChannel: null });
  const server = logs.serverlog.length;
  await slog.memberJoined(joiner('late', 50));
  const p = slog.memberLeft({ guild, user: person('late2'), joinedTimestamp: Date.now(), roles: { cache: new Collection() } });
  await wait(slog.AUDIT_DELAY_MS);
  await p;
  assert.equal(logs.serverlog.length, server + 2);
  await updateSettings('g1', { joinLogChannel: 'joinlog', leaveLogChannel: 'leavelog', modLogChannel: 'modlog' });
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
