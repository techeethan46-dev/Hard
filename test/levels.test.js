import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField } from 'discord.js';
import { buttonLabels, customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
const { levelInfo, totalXpFor, xpToNext } = await import('../src/lib/levels.js');
const S = await import('../src/lib/streaks.js');
const { withBadge, stripBadge, setStreakBadge } = await import('../src/lib/nickname.js');

// ---------------------------------------------------------------- pure rules

test('level math', () => {
  assert.deepEqual([0, 1, 2, 3].map(xpToNext), [100, 155, 220, 295]);
  assert.deepEqual(levelInfo(0), { level: 0, into: 0, needed: 100 });
  assert.deepEqual(levelInfo(99), { level: 0, into: 99, needed: 100 });
  assert.deepEqual(levelInfo(100), { level: 1, into: 0, needed: 155 });
  for (const l of [1, 5, 10, 50]) assert.equal(levelInfo(totalXpFor(l)).level, l);
});

test('streak grows on consecutive days, once per day', () => {
  let s = S.recordChat(null, '2026-03-01').streak;
  assert.equal(s.current, 1);
  assert.equal(S.recordChat(s, '2026-03-01').changed, false);
  s = S.recordChat(s, '2026-03-02').streak;
  s = S.recordChat(s, '2026-03-03').streak;
  assert.equal(s.current, 3);
  assert.equal(s.best, 3);
});

test('missing a day breaks it, and a restore brings it back', () => {
  let s = { current: 12, best: 12, lastDay: '2026-03-10' };
  // skipped the 11th, chats on the 12th
  const r = S.recordChat(s, '2026-03-12');
  assert.equal(r.broke, true);
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.lost, 12);
  const q = S.restoreQuote(r.streak, '2026-03-12');
  assert.deepEqual(q, { possible: true, cost: 1, left: 3, value: 13, reason: null });
  s = S.applyRestore(r.streak, '2026-03-12');
  assert.equal(s.current, 13);
  assert.equal(S.restoresLeft(s, '2026-03-12'), 2);
  // keeps going the next day
  assert.equal(S.recordChat(s, '2026-03-13').streak.current, 14);
});

test('each missed day costs a restore; 3 per month; resets next month', () => {
  const broken = S.breakIfStale({ current: 5, lastDay: '2026-03-10' }, '2026-03-14'); // missed 11, 12, 13
  assert.equal(S.restoreQuote(broken, '2026-03-14').cost, 3);
  const used = { ...broken, restores: { month: '2026-03', used: 1 } };
  assert.equal(S.restoreQuote(used, '2026-03-14').possible, false);
  assert.equal(S.restoreQuote(used, '2026-03-14').reason, 'not-enough');
  assert.equal(S.restoresLeft(used, '2026-04-01'), 3);
});

test('restoring before chatting again: the streak continues when they chat that day', () => {
  const broken = S.breakIfStale({ current: 7, best: 7, lastDay: '2026-03-10' }, '2026-03-12');
  const restored = S.applyRestore(broken, '2026-03-12');
  assert.equal(restored.current, 7);
  assert.equal(S.breakIfStale(restored, '2026-03-12'), null);
  assert.equal(S.recordChat(restored, '2026-03-12').streak.current, 8);
});

test('day keys follow the server timezone', () => {
  const t = new Date('2026-03-10T03:00:00Z');
  assert.equal(S.dayKey(t, 'UTC'), '2026-03-10');
  assert.equal(S.dayKey(t, 'America/New_York'), '2026-03-09');
  assert.equal(S.dayKey(t, 'Not/AZone'), '2026-03-10'); // bad value falls back to UTC
  assert.equal(S.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(S.daysBetween('2026-12-31', '2027-01-02'), 2);
});

test('nickname badge', () => {
  assert.equal(withBadge('Superman', 1), 'Superman [1🔥]');
  assert.equal(withBadge('Superman [1🔥]', 2), 'Superman [2🔥]');
  assert.equal(withBadge('Superman [9🔥]', 0), 'Superman');
  assert.equal(stripBadge('Builder (@builderman) [30🔥]'), 'Builder (@builderman)');
  const long = withBadge('A'.repeat(40), 123);
  assert.ok(long.length <= 32 && long.endsWith('[123🔥]'));
});

test('badge is removed cleanly for someone without a nickname', async () => {
  const set = [];
  const m = { id: 'u', guild: { ownerId: 'o' }, manageable: true, nickname: 'Superman [3🔥]', displayName: 'Superman [3🔥]',
    user: { globalName: 'Superman' }, setNickname: async (n) => { set.push(n); m.nickname = n; } };
  await setStreakBadge(m, 0);
  assert.deepEqual(set, [null]);
  assert.equal(await setStreakBadge({ ...m, id: 'o' }, 5), false); // owner can't be renamed
});

// ---------------------------------------------------------------- message handler + commands

const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ jsonPath: null });
const { updateSettings } = await import('../src/lib/settings.js');
await updateSettings('g1', { levelRewards: [{ roleId: 'r5', level: 1 }], streakTimezone: 'UTC' });
const { onMessage, sweepStreaks } = await import('../src/lib/activity.js');

const ALL = new PermissionsBitField(PermissionsBitField.All);
const sent = [];
const channel = { id: 'c1', isTextBased: () => true, send: async (m) => { sent.push(m); return {}; } };
const guild = {
  id: 'g1', name: 'Cool Server', ownerId: 'owner', iconURL: () => 'https://cdn.discordapp.com/i.png',
  roles: { cache: new Map([['r5', { id: 'r5', position: 1 }]]) },
  channels: { fetch: async () => null },
  members: { me: { roles: { highest: { position: 10 } }, permissions: ALL } },
};
const roles = new Set();
const member = {
  id: 'u1', guild, manageable: true, nickname: null, displayName: 'Superman', user: { globalName: 'Superman', username: 'superman' },
  roles: { cache: { has: (r) => roles.has(r) }, add: async (r) => roles.add(r) },
  setNickname: async (n) => { member.nickname = n; member.displayName = n ?? 'Superman'; },
};
guild.members.fetch = async () => member;
const replies = [];
const msg = () => ({
  inGuild: () => true, guildId: 'g1', guild, channel, member,
  author: { id: 'u1', bot: false, toString: () => '<@u1>', displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' },
  reply: async (m) => { replies.push(m); return { delete: async () => {} }; },
});

test('chatting gives XP once a minute, levels up with a reward, and adds the 🔥 badge', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-03-01T12:00:00Z') });
  try {
    for (let i = 0; i < 8; i++) {
      await onMessage(msg());
      mock.timers.tick(61_000);
    }
    const doc = await store.stats.get('g1', 'u1');
    assert.ok(doc.xp >= 120 && doc.xp <= 200, `xp ${doc.xp}`);
    assert.equal(doc.streak.current, 1);
    assert.equal(member.nickname, 'Superman [1🔥]');
    assert.ok(roles.has('r5'), 'level 1 reward given');
    const levelUp = sent.find((m) => /Level up!/.test(textOf(m)));
    assert.ok(levelUp && isV2(levelUp));
    assert.match(textOf(levelUp), /reached \*\*level 1\*\*/);
    assert.match(textOf(levelUp), /Unlocked <@&r5>/);
    assert.doesNotMatch(textOf(levelUp), /▰|▱/, 'no progress bar');
    assert.match(textOf(levelUp), /\n-# \d+ XP to level 2/, 'the XP line is on its own line so Discord shows it as small text');
    json(levelUp);

    // spam within the same minute gives nothing
    await onMessage(msg()); // a minute has passed: this one counts
    const before = (await store.stats.get('g1', 'u1')).xp;
    await onMessage(msg());
    await onMessage(msg());
    assert.equal((await store.stats.get('g1', 'u1')).xp, before);

    // next day -> 2🔥
    mock.timers.tick(24 * 3600_000);
    await onMessage(msg());
    assert.equal(member.nickname, 'Superman [2🔥]');

    // skip a whole day: the sweep removes the badge
    mock.timers.tick(48 * 3600_000);
    await sweepStreaks({ guilds: { cache: new Map([['g1', guild]]) } });
    assert.equal(member.nickname, null);
    assert.equal((await store.stats.get('g1', 'u1')).streak.lost, 2);

    // they chat again: new streak + a "streak ended" message with a restore button
    await onMessage(msg());
    assert.equal(member.nickname, 'Superman [1🔥]');
    const notice = replies.at(-1);
    assert.match(textOf(notice), /Your 2🔥 streak ended/);
    assert.match(textOf(notice), /missed \*\*1 day\*\*/); // the 3rd
    assert.deepEqual(customIds(notice), ['streak:restore:u1:notice']);
    json(notice);
  } finally {
    mock.timers.reset();
  }
});

const ix = (opts = {}) => {
  const calls = [];
  const rec = async (p) => { calls.push(p); };
  return {
    calls, guild, guildId: 'g1', member,
    user: { id: 'u1', username: 'superman', displayName: 'Superman', bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' },
    options: { getUser: () => null, getMember: () => member, getString: () => null, getSubcommand: () => opts.sub, getInteger: (k) => opts[k] },
    reply: rec, update: rec, message: { delete: async () => { calls.push('deleted'); }, flags: { has: () => false } },
    ...opts,
  };
};

test('/streak and restoring from the button', async () => {
  const streak = await import('../src/commands/streak.js');
  const i = ix();
  await streak.execute(i);
  assert.match(textOf(i.calls[0]), /1 day streak/);
  assert.match(textOf(i.calls[0]), /Your \*\*2🔥\*\* streak broke\. Restoring costs \*\*1\*\*/);
  json(i.calls[0]);

  const someoneElse = ix({ customId: 'streak:restore:u1:notice', user: { id: 'u2' } });
  await streak.handleButton(someoneElse);
  assert.match(textOf(someoneElse.calls[0]), /for someone else/);

  const b = ix({ customId: 'streak:restore:u1:notice' });
  await streak.handleButton(b);
  assert.match(textOf(b.calls[0]), /Streak restored!/);
  assert.match(textOf(b.calls[0]), /back at \*\*3 days\*\*/);
  assert.equal(b.calls[1], 'deleted'); // the public notice is removed
  assert.equal(member.nickname, 'Superman [3🔥]');
  const doc = await store.stats.get('g1', 'u1');
  assert.equal(S.restoresLeft(doc.streak, S.dayKey(new Date())), 2);
});

test('/rank and /leaderboard', async () => {
  await store.stats.set('g1', 'u2', { xp: 5000, streak: { current: 40, best: 40, lastDay: '2026-01-01' } });
  const rank = await import('../src/commands/rank.js');
  const r = ix();
  await rank.execute(r);
  json(r.calls[0]);
  assert.match(textOf(r.calls[0]), /\*\*Level 1\*\* · #2 in the server/);
  assert.match(textOf(r.calls[0]), /3\*\* day streak/);

  const lb = await import('../src/commands/leaderboard.js');
  const l = ix({ by: null });
  l.options.getString = () => null;
  await lb.execute(l);
  json(l.calls[0]);
  assert.match(textOf(l.calls[0]), /🥇 <@u2> · \*\*Level 10\*\* · 5,000 XP/);
  assert.match(textOf(l.calls[0]), /🥈 <@u1>/);
  assert.match(textOf(l.calls[0]), /You're #2/);

  const sw = ix({ customId: 'leaderboard:streak' });
  await lb.handleButton(sw);
  assert.match(textOf(sw.calls[0]), /🔥 Streak leaderboard/);
  assert.match(textOf(sw.calls[0]), /🥇 <@u2> · \*\*40🔥\*\*/);
  assert.deepEqual(buttonLabels(sw.calls[0]), ['Levels', 'Streaks', 'Coins']);
});

test('/xp set-level and reset', async () => {
  const xp = await import('../src/commands/xp.js');
  const i = ix({ sub: 'set-level', level: 10 });
  i.options.getUser = () => ({ id: 'u1', bot: false, toString: () => '<@u1>' });
  await xp.execute(i);
  assert.match(textOf(i.calls[0]), /now \*\*level 10\*\*/);
  assert.equal(levelInfo((await store.stats.get('g1', 'u1')).xp).level, 10);

  const r = ix({ sub: 'reset' });
  r.options.getUser = i.options.getUser;
  await xp.execute(r);
  assert.equal((await store.stats.get('g1', 'u1')).xp, 0);
  assert.match(textOf(r.calls[0]), /XP reset/);
  // the streak is a separate thing: /xp reset doesn't touch it
  assert.equal((await store.stats.get('g1', 'u1')).streak.current, 3);
  assert.equal(member.nickname, 'Superman [3🔥]');
});

// ---------------------------------------------------------------- nickname changes, streak roles, /streak-admin

const activity = await import('../src/lib/activity.js');
const adminCmd = await import('../src/commands/streakadmin.js');
const today = () => S.dayKey(new Date(), 'UTC');
for (const [id, position] of [['sr7', 1], ['sr30', 1], ['sr365', 99]]) guild.roles.cache.set(id, { id, position });
member.roles.remove = async (r) => { [].concat(r).forEach((x) => roles.delete(x)); };
const fakeMember = (id, nickname, extra = {}) => ({
  id, nickname, displayName: nickname ?? id, guild, manageable: true, user: { globalName: id, username: id, bot: false },
  setNickname: async (n) => { fakeMember.last = n; const m = fakeMemberMap[id]; m.nickname = n; m.displayName = n ?? id; },
  ...extra,
});
const fakeMemberMap = {};
const make = (id, nickname) => (fakeMemberMap[id] = fakeMember(id, nickname));

test('changing your own nickname brings the 🔥 badge back immediately', async () => {
  await store.stats.set('g1', 'nick1', { streak: { current: 5, best: 5, lastDay: today(), startDay: S.addDays(today(), -4) } });
  const m = make('nick1', 'Clark'); // they just renamed themselves, so the badge is gone
  await activity.restoreNickname({ partial: false, nickname: 'Superman [5🔥]' }, m);
  assert.equal(m.nickname, 'Clark [5🔥]');

  // setting it again changes nothing (so the bot's own change can't start a loop)
  fakeMember.last = 'untouched';
  await activity.restoreNickname({ partial: false, nickname: 'Clark' }, m);
  assert.equal(fakeMember.last, 'untouched');

  // clearing the nickname: back to their name with the badge
  const m2 = make('nick1', null);
  await activity.restoreNickname({ partial: false, nickname: 'Clark [5🔥]' }, m2);
  assert.equal(m2.nickname, 'nick1 [5🔥]');

  // yesterday still counts (the streak only ends after a whole missed day)...
  await store.stats.set('g1', 'nick1', { streak: { current: 5, best: 5, lastDay: S.addDays(today(), -1) } });
  const m3 = make('nick1', 'Bruce');
  await activity.restoreNickname({ partial: false, nickname: 'x' }, m3);
  assert.equal(m3.nickname, 'Bruce [5🔥]');

  // ...but a broken streak gets no badge
  await store.stats.set('g1', 'nick1', { streak: { current: 5, best: 5, lastDay: S.addDays(today(), -3) } });
  const m4 = make('nick1', 'Dick');
  await activity.restoreNickname({ partial: false, nickname: 'x' }, m4);
  assert.equal(m4.nickname, 'Dick');

  // people who can't be renamed and bots are left alone
  await store.stats.set('g1', 'nick1', { streak: { current: 5, best: 5, lastDay: today() } });
  const owner = make('nick1', 'Boss');
  owner.manageable = false;
  await activity.restoreNickname({ partial: false, nickname: 'x' }, owner);
  assert.equal(owner.nickname, 'Boss');
});

test('the [AFK] tag survives a nickname change too', async () => {
  const { setAfk } = { setAfk: (id) => store.stats.set('g1', id, { afk: { reason: 'tired', since: Date.now(), pings: [] } }) };
  await setAfk('nick2');
  await store.stats.set('g1', 'nick2', { streak: { current: 2, best: 2, lastDay: today() } });
  const m = make('nick2', 'Selina');
  await activity.restoreNickname({ partial: false, nickname: 'Catwoman [2🔥]' }, m);
  assert.equal(m.nickname, '[AFK] Selina [2🔥]');
});

test('streak roles: given at the days, taken away when the streak drops (unless kept)', async () => {
  await updateSettings('g1', { streakRewards: [{ roleId: 'sr7', days: 7 }, { roleId: 'sr30', days: 30 }, { roleId: 'sr365', days: 365 }], streakRolesKeep: null });
  roles.clear();
  const settings = await (await import('../src/lib/settings.js')).getSettings('g1');

  assert.deepEqual(await activity.syncStreakRoles(member, settings, 6), []);
  assert.deepEqual([...roles], []);
  assert.deepEqual((await activity.syncStreakRoles(member, settings, 7)).map((r) => r.roleId), ['sr7']);
  assert.deepEqual((await activity.syncStreakRoles(member, settings, 7)).map((r) => r.roleId), [], 'only announced once');
  assert.deepEqual((await activity.syncStreakRoles(member, settings, 40)).map((r) => r.roleId), ['sr30']);
  assert.deepEqual([...roles].sort(), ['sr30', 'sr7']);
  assert.ok(!roles.has('sr365'), 'a role above the bot is never given');

  await activity.syncStreakRoles(member, settings, 10); // dropped below 30
  assert.deepEqual([...roles], ['sr7']);
  await activity.syncStreakRoles(member, settings, 0);
  assert.deepEqual([...roles], []);

  // "let them keep the roles"
  const keep = { ...settings, streakRolesKeep: 'keep' };
  await activity.syncStreakRoles(member, keep, 30);
  await activity.syncStreakRoles(member, keep, 0);
  assert.deepEqual([...roles].sort(), ['sr30', 'sr7']);
  roles.clear();
});

test('reaching the days in chat gives the role and announces it', async () => {
  roles.clear();
  await store.stats.set('g1', 'u1', { streak: { current: 6, best: 6, lastDay: S.addDays(today(), -1), startDay: S.addDays(today(), -6) } });
  const before = sent.length;
  await onMessage(msg());
  assert.equal((await store.stats.get('g1', 'u1')).streak.current, 7);
  assert.ok(roles.has('sr7'));
  assert.match(member.nickname, /\[7🔥\]$/);
  const card = sent.slice(before).find((m) => /7-day streak!/.test(textOf(m)));
  assert.ok(card, 'milestone card sent');
  assert.match(textOf(card), /unlocked <@&sr7>/);
  json(card);
});

test('a broken streak loses the badge and the streak roles', async () => {
  await store.stats.set('g1', 'u1', { streak: { current: 8, best: 8, lastDay: S.addDays(today(), -3), startDay: S.addDays(today(), -10) } });
  roles.add('sr7');
  await sweepStreaks({ guilds: { cache: new Map([['g1', guild]]) } });
  assert.ok(!roles.has('sr7'));
  assert.doesNotMatch(member.nickname ?? '', /🔥/);
  assert.equal((await store.stats.get('g1', 'u1')).streak.lost, 8);
});

test('/streak shows the next streak role, and restoring gives the roles back', async () => {
  const streak = await import('../src/commands/streak.js');
  await store.stats.set('g1', 'u1', { streak: { current: 3, best: 8, lastDay: today(), startDay: S.addDays(today(), -2), lost: 0 } });
  const i = ix();
  await streak.execute(i);
  assert.match(textOf(i.calls[0]), /\*\*7 days\*\* unlocks <@&sr7> · 4 to go/);
});

test('/streak-admin: set, reset and refill restores; XP is never touched', async () => {
  roles.clear();
  const xpBefore = (await store.stats.get('g1', 'u1')).xp;
  const run = async (sub, extra = {}) => {
    const i = ix({ sub, ...extra });
    i.options.getUser = () => ({ id: 'u1', bot: false, toString: () => '<@u1>' });
    await adminCmd.execute(i);
    return textOf(i.calls[0]);
  };

  assert.match(await run('set', { days: 30 }), /Streak set[\s\S]*30-day\*\* streak/);
  const doc = await store.stats.get('g1', 'u1');
  assert.equal(doc.streak.current, 30);
  assert.equal(doc.streak.lastDay, today());
  assert.equal(doc.streak.best, 30);
  assert.match(member.nickname, /\[30🔥\]$/);
  assert.deepEqual([...roles].sort(), ['sr30', 'sr7']);
  // setting it makes today count, so the next message continues it instead of restarting
  assert.equal(S.recordChat(doc.streak, S.addDays(today(), 1)).streak.current, 31);

  assert.match(await run('reset'), /Streak removed/);
  assert.equal((await store.stats.get('g1', 'u1')).streak, null);
  assert.doesNotMatch(member.nickname ?? '', /🔥/);
  assert.deepEqual([...roles], []);

  await store.stats.set('g1', 'u1', { streak: { current: 2, best: 2, lastDay: today(), restores: { month: today().slice(0, 7), used: 3 } } });
  assert.match(await run('restores'), /3\/3\*\* restores/);
  assert.equal(S.restoresLeft((await store.stats.get('g1', 'u1')).streak, today()), 3);
  assert.equal((await store.stats.get('g1', 'u1')).xp, xpBefore);

  const bot = ix({ sub: 'set', days: 5 });
  bot.options.getUser = () => ({ id: 'b', bot: true });
  await adminCmd.execute(bot);
  assert.match(textOf(bot.calls[0]), /Bots don't have streaks/);
});
