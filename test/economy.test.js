import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { buttonLabels, customIds, isV2, json, textOf } from './helpers.js';

process.env.DISCORD_TOKEN = 'x';
const { initStore } = await import('../src/lib/store.js');
const store = await initStore({ mongoUri: '', jsonPath: null });
const { updateSettings, getSettings } = await import('../src/lib/settings.js');
const E = await import('../src/lib/economy.js');

const realInt = E.rng.int;
/** Forces the random numbers: the next calls return these values, then the real generator again. */
const force = (...values) => { const q = [...values]; E.rng.int = (n) => (q.length ? q.shift() : realInt(n)); };
const restore = () => { E.rng.int = realInt; };
/** A repeatable random generator: the same seed always gives the same numbers. */
function lcg(seed) {
  let x = seed >>> 0;
  return (n) => { x = (x * 1664525 + 1013904223) >>> 0; return Math.floor((x / 2 ** 32) * n); };
}

// ---------------------------------------------------------------- bets

test('bets: numbers, k and m, all and half, with clear errors', () => {
  const ok = (input, balance, amount) => assert.deepEqual(E.parseBet(input, balance), { amount }, input);
  ok('500', 1000, 500);
  ok('1,000', 5000, 1000);
  ok('1.5k', 5000, 1500);
  ok('2K', 5000, 2000);
  ok('all', 800, 800);
  ok('half', 801, 400);
  ok('all', 1_000_000, E.MAX_BET); // capped
  ok(' 50 ', 100, 50);
  for (const bad of ['', 'abc', '-5', '5 coins', '1e3', '0x10']) assert.match(E.parseBet(bad, 1000).error, /Type a number/, bad);
  assert.match(E.parseBet('5', 1000).error, /smallest bet is 🪙 10/);
  assert.match(E.parseBet('all', 3).error, /smallest bet/);
  assert.match(E.parseBet('60k', 1_000_000).error, /biggest bet is 🪙 50,000/);
});

// ---------------------------------------------------------------- the games' maths

test('slots pay back about 87% on average, worked out exactly and checked by simulation', () => {
  const exact = E.slotsReturn();
  assert.ok(exact > 0.85 && exact < 0.9, `exact return ${exact}`);

  // a seeded generator, so this check gives the same answer every time
  E.rng.int = lcg(123456789);
  let paid = 0;
  const spins = 400_000;
  for (let i = 0; i < spins; i++) paid += E.spinSlots().multiplier;
  restore();
  assert.ok(Math.abs(paid / spins - exact) < 0.04, `simulated ${paid / spins} vs exact ${exact}`);
});

test('slots outcomes: three of a kind, a pair, nothing', () => {
  force(0, 0, 0);
  assert.deepEqual(E.spinSlots(), { reels: ['🍒', '🍒', '🍒'], multiplier: 4, kind: 'triple', symbol: '🍒' });
  force(99, 99, 99);
  assert.equal(E.spinSlots().multiplier, 500); // 7️⃣
  force(0, 0, 40);
  assert.deepEqual([E.spinSlots().kind, E.spinSlots().kind].length, 2);
  force(0, 0, 40);
  assert.equal(E.spinSlots().kind, 'pair');
  force(0, 40, 60);
  assert.equal(E.spinSlots().kind, 'none');
  restore();
});

test('blackjack maths: aces, naturals, dealer rule, and who wins', () => {
  const c = (r, s = '♠') => ({ r, s });
  assert.equal(E.handValue([c('A'), c('K')]), 21);
  assert.equal(E.handValue([c('A'), c('A'), c('9')]), 21);
  assert.equal(E.handValue([c('A'), c('6'), c('10')]), 17, 'the ace drops to 1 instead of busting');
  assert.equal(E.handValue([c('K'), c('Q'), c('2')]), 22);
  assert.ok(E.isNatural([c('A'), c('Q')]));
  assert.ok(!E.isNatural([c('7'), c('7'), c('7')]), 'three cards making 21 is not a natural');

  // the dealer draws to 17 and stands on every 17, even a soft one
  const soft = E.dealerPlay([c('2')], [c('A'), c('6')]);
  assert.equal(soft.length, 2);
  const draws = E.dealerPlay([c('3'), c('4')], [c('5'), c('6')]); // 11 -> +4 = 15 -> +3 = 18
  assert.equal(E.handValue(draws), 18);

  const r = (p, d, bet = 100) => E.settle(p, d, bet);
  assert.deepEqual(r([c('10'), c('9')], [c('10'), c('8')]), { outcome: 'win', payout: 200 });
  assert.deepEqual(r([c('10'), c('8')], [c('10'), c('8')]), { outcome: 'push', payout: 100 });
  assert.deepEqual(r([c('10'), c('7')], [c('10'), c('8')]), { outcome: 'lose', payout: 0 });
  assert.deepEqual(r([c('10'), c('6'), c('9')], [c('10'), c('8')]), { outcome: 'lose', payout: 0 }, 'bust loses even if the dealer would bust too');
  assert.deepEqual(r([c('10'), c('7')], [c('10'), c('6'), c('9')]), { outcome: 'win', payout: 200 }, 'dealer busts');
  assert.deepEqual(r([c('A'), c('K')], [c('10'), c('8')]), { outcome: 'blackjack', payout: 250 });
  assert.deepEqual(r([c('A'), c('K')], [c('A'), c('Q')]), { outcome: 'push', payout: 100 });
  assert.deepEqual(r([c('10'), c('9')], [c('A'), c('Q')]), { outcome: 'lose', payout: 0 });
  assert.equal(r([c('A'), c('K')], [c('10'), c('8')], 15).payout, 37, '2.5 times, rounded down');
});

test('a fresh deck has 52 different cards', () => {
  const deck = E.newDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((x) => x.r + x.s)).size, 52);
});

// ---------------------------------------------------------------- fakes

const ADMIN = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
const NONE = new PermissionsBitField(0n);
const avatar = () => 'https://cdn.discordapp.com/a.png';
const person = (id, extra = {}) => ({ id, bot: false, username: id, displayName: id, toString: () => `<@${id}>`, displayAvatarURL: avatar, ...extra });
const roleSet = new Set();
const guild = {
  id: 'g1', name: 'Wobble League', iconURL: () => null, members: { me: { roles: { highest: { position: 10 } } } },
  roles: { cache: new Map([['vip', { id: 'vip', name: 'VIP', position: 1, permissions: new PermissionsBitField(0n), managed: false, toString: () => '<@&vip>' }],
    ['mod', { id: 'mod', name: 'Mod', position: 1, permissions: new PermissionsBitField(PermissionFlagsBits.BanMembers), managed: false, toString: () => '<@&mod>' }]]) },
};
const me = { roles: { cache: { has: (r) => roleSet.has(r) }, add: async (r) => { roleSet.add(r); }, remove: async (r) => { roleSet.delete(r); } } };

function ix(opts = {}) {
  const calls = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  const o = opts.options ?? {};
  return {
    calls, guild, guildId: 'g1', user: person(opts.user ?? 'u1'), member: opts.member ?? me, memberPermissions: opts.perms ?? NONE,
    options: {
      getUser: (k) => o[k] ?? null, getString: (k) => o[k] ?? null, getInteger: (k) => o[k] ?? null, getRole: (k) => o[k] ?? null,
      getSubcommand: () => opts.sub,
    },
    customId: opts.customId, values: opts.values, message: opts.message ?? { id: opts.messageId ?? 'm1' },
    reply: rec('reply'), update: rec('update'), editReply: rec('editReply'),
  };
}
const coins = async (id = 'u1') => (await store.stats.get('g1', id))?.coins ?? 0;
const give = (n, id = 'u1') => store.stats.addCoins('g1', id, n);
const reset = async (id = 'u1') => { await store.stats.set('g1', id, { coins: 0 }); };
const said = (i) => textOf(i.calls.at(-1).p);
const card = (i) => { json(i.calls.at(-1).p); return said(i); };

// ---------------------------------------------------------------- daily, balance, pay, admin

test('/daily: 250 coins once a day', async () => {
  const daily = await import('../src/commands/daily.js');
  const first = ix();
  await daily.execute(first);
  assert.match(card(first), /🎁 Daily reward\nYou got \*\*🪙 250\*\*!/);
  assert.equal(await coins(), 250);
  const again = ix();
  await daily.execute(again);
  assert.match(said(again), /already claimed/);
  assert.equal(await coins(), 250);
});

test('/balance: your wallet, your rank, and whether the daily is ready', async () => {
  const balance = await import('../src/commands/balance.js');
  await give(750, 'rich');
  const i = ix({ options: {} });
  i.options.getUser = () => null;
  await balance.execute(i);
  const t = card(i);
  assert.match(t, /u1's wallet\n\*\*🪙 250\*\*\n-# #2 richest/);
  assert.match(t, /Daily reward: ✅ already claimed today/);

  const other = ix({ options: { member: person('rich') } });
  await balance.execute(other);
  assert.match(card(other), /rich's wallet\n\*\*🪙 750\*\*\n-# #1 richest/);
  assert.doesNotMatch(said(other), /Daily reward/, 'only shown for yourself');

  const bot = ix({ options: { member: person('bot', { bot: true }) } });
  await balance.execute(bot);
  assert.match(said(bot), /Bots don't have wallets/);
});

test('/pay: sends coins, and refuses the impossible', async () => {
  const pay = await import('../src/commands/pay.js');
  await reset('u1'); await give(300); await reset('u2');
  const ok = ix({ options: { member: person('u2'), amount: 120 } });
  await pay.execute(ok);
  assert.match(card(ok), /Coins sent[\s\S]*sent \*\*🪙 120\*\* to <@u2>[\s\S]*🪙 180 left/);
  assert.equal(await coins('u1'), 180);
  assert.equal(await coins('u2'), 120);

  const tooMuch = ix({ options: { member: person('u2'), amount: 500 } });
  await pay.execute(tooMuch);
  assert.match(said(tooMuch), /Not enough coins[\s\S]*only have \*\*🪙 180\*\*/);
  assert.equal(await coins('u1'), 180);

  for (const [to, re] of [[person('u1'), /pay yourself/], [person('b', { bot: true }), /Bots can't use coins/]]) {
    const i = ix({ options: { member: to, amount: 5 } });
    await pay.execute(i);
    assert.match(said(i), re);
  }
});

test('/economy give and take (never below zero)', async () => {
  const eco = await import('../src/commands/economy.js');
  await reset('u2');
  const g = ix({ sub: 'give', options: { member: person('u2'), amount: 500 }, perms: ADMIN });
  await eco.execute(g);
  assert.match(said(g), /Coins given[\s\S]*now has \*\*🪙 500\*\*/);
  const t = ix({ sub: 'take', options: { member: person('u2'), amount: 9999 }, perms: ADMIN });
  await eco.execute(t);
  assert.match(said(t), /Took \*\*🪙 500\*\*[\s\S]*now have \*\*🪙 0\*\*/);
  assert.equal(await coins('u2'), 0);
  assert.equal(eco.data.toJSON().default_member_permissions, String(PermissionFlagsBits.ManageGuild));
});

// ---------------------------------------------------------------- coinflip, slots

test('/coinflip: double or nothing, and the coins move correctly', async () => {
  const flipCmd = await import('../src/commands/coinflip.js');
  await reset(); await give(1000);

  force(0); // heads
  const win = ix({ options: { bet: '100', side: 'heads' } });
  await flipCmd.execute(win);
  assert.match(card(win), /Coinflip\nYou picked \*\*heads\*\* and it landed on \*\*heads\*\*\./);
  assert.match(said(win), /You won \*\*🪙 100\*\*![\s\S]*Balance: 🪙 1,100/);
  assert.equal(await coins(), 1100);

  force(0);
  const lose = ix({ options: { bet: '100', side: 'tails' } });
  await flipCmd.execute(lose);
  assert.match(said(lose), /You lost \*\*🪙 100\*\*[\s\S]*Balance: 🪙 1,000/);
  assert.equal(await coins(), 1000);

  force(1); // tails
  const half = ix({ options: { bet: 'half', side: 'tails' } });
  await flipCmd.execute(half);
  assert.equal(await coins(), 1500); // bet 500, won 1000 back
  restore();

  const broke = ix({ options: { bet: '999999', side: 'heads' } });
  await flipCmd.execute(broke);
  assert.match(said(broke), /Invalid bet|biggest bet/);
  const poor = ix({ options: { bet: '40k', side: 'heads' } });
  await flipCmd.execute(poor);
  assert.match(said(poor), /Not enough coins[\s\S]*only have \*\*🪙 1,500\*\*/);
  assert.equal(await coins(), 1500, 'a refused bet costs nothing');
});

test('/slots: triple pays, pair returns the bet, nothing loses', async () => {
  const slots = await import('../src/commands/slots.js');
  await reset(); await give(1000);

  force(0, 0, 0);
  const triple = ix({ options: { bet: '100' } });
  await slots.execute(triple);
  assert.match(card(triple), /🍒  ┃  🍒  ┃  🍒/);
  assert.match(said(triple), /Three 🍒 · \*\*4×\*\*, you won \*\*🪙 300\*\*!/);
  assert.equal(await coins(), 1300);

  force(99, 99, 99);
  const jackpot = ix({ options: { bet: '10' } });
  await slots.execute(jackpot);
  assert.match(said(jackpot), /JACKPOT[\s\S]*500×/);
  assert.equal(await coins(), 1300 - 10 + 5000);

  force(0, 0, 40);
  const before = await coins();
  const pair = ix({ options: { bet: '100' } });
  await slots.execute(pair);
  assert.match(said(pair), /Two matching/);
  assert.equal(await coins(), before);

  force(0, 40, 60);
  const none = ix({ options: { bet: '100' } });
  await slots.execute(none);
  assert.match(said(none), /No match · you lost \*\*🪙 100\*\*/);
  assert.equal(await coins(), before - 100);
  restore();
});

// ---------------------------------------------------------------- roulette

test('/roulette: pick a color, the coins are taken then, the wheel decides', async () => {
  const roulette = await import('../src/commands/roulette.js');
  roulette.timing.spinMs = 0;
  await reset(); await give(1000);

  const start = ix({ options: { bet: '100' } });
  await roulette.execute(start);
  json(start.calls[0].p);
  assert.match(textOf(start.calls[0].p), /Bet: \*\*🪙 100\*\*[\s\S]*2\.7×/);
  assert.deepEqual(buttonLabels(start.calls[0].p), ['Red', 'Blue', 'Green']);
  assert.deepEqual(customIds(start.calls[0].p), ['roulette:red:100:u1', 'roulette:blue:100:u1', 'roulette:green:100:u1']);
  assert.equal(await coins(), 1000, 'nothing is taken until you pick');

  // someone else can't pick for you
  const thief = ix({ user: 'u2', customId: 'roulette:red:100:u1', messageId: 'r1' });
  await roulette.handleButton(thief);
  assert.match(said(thief), /someone else's game/);

  force(1); // blue
  const win = ix({ customId: 'roulette:blue:100:u1', messageId: 'r1' });
  await roulette.handleButton(win);
  assert.match(textOf(win.calls[0].p), /spinning/);
  assert.match(textOf(win.calls[1].p), /bet on 🔵 \*\*Blue\*\* · it landed on 🔵 \*\*Blue\*\*[\s\S]*You won \*\*🪙 170\*\*![\s\S]*Balance: 🪙 1,170/);
  assert.equal(await coins(), 1170); // 100 bet, 270 back
  json(win.calls[1].p);

  // tapping the same round again does nothing
  const again = ix({ customId: 'roulette:blue:100:u1', messageId: 'r1' });
  await roulette.handleButton(again);
  assert.match(said(again), /already started/);
  assert.equal(await coins(), 1170);

  force(2); // green
  const lose = ix({ customId: 'roulette:red:100:u1', messageId: 'r2' });
  await roulette.handleButton(lose);
  restore();
  assert.match(textOf(lose.calls[1].p), /landed on 🟢 \*\*Green\*\*[\s\S]*You lost \*\*🪙 100\*\*/);
  assert.equal(await coins(), 1070);

  // coins spent elsewhere in the meantime
  await reset();
  const broke = ix({ customId: 'roulette:red:100:u1', messageId: 'r3' });
  await roulette.handleButton(broke);
  assert.match(textOf(broke.calls[0].p), /Not enough coins/);

  const notEnough = ix({ options: { bet: '500' } });
  await roulette.execute(notEnough);
  assert.match(said(notEnough), /Not enough coins/);
});

test('roulette is fair across the three colors', () => {
  E.rng.int = lcg(42);
  const counts = { red: 0, blue: 0, green: 0 };
  for (let i = 0; i < 30_000; i++) counts[E.spinRoulette().id]++;
  restore();
  for (const n of Object.values(counts)) assert.ok(Math.abs(n - 10_000) < 400, JSON.stringify(counts));
  assert.ok(E.ROULETTE_PAYOUT / 3 < 1, 'the house keeps a small edge');
});

// ---------------------------------------------------------------- blackjack

const bj = await import('../src/commands/blackjack.js');
const c = (r, s = '♠') => ({ r, s });
async function startHand(bet = '100') {
  bj.games.clear();
  const i = ix({ options: { bet } });
  // find a shuffle where nobody is dealt a natural 21, so the hand stays open
  let seed = 1;
  for (;; seed++) {
    E.rng.int = lcg(seed);
    const d = E.newDeck();
    if (!E.isNatural([d.at(-1), d.at(-2)]) && !E.isNatural([d.at(-3), d.at(-4)])) break;
  }
  E.rng.int = lcg(seed);
  await bj.execute(i);
  restore();
  const g = bj.games.get('g1:u1');
  return { i, g };
}
const press = async (action, extra = {}) => { const i = ix({ customId: `blackjack:${action}`, ...extra }); await bj.handleButton(i); return i; };

test('/blackjack: a hand with Hit, Stand and Double buttons, and the bet taken up front', async () => {
  await reset(); await give(1000);
  const { i, g } = await startHand();
  assert.ok(g, 'the hand is open');
  json(i.calls[0].p);
  assert.match(textOf(i.calls[0].p), /Blackjack\nBet: \*\*🪙 100\*\*[\s\S]*\*\*Dealer\*\* `\S+` `\?\?`\n\*\*You\*\* /);
  assert.deepEqual(buttonLabels(i.calls[0].p), ['Hit', 'Stand', 'Double']);
  assert.equal(await coins(), 900);

  const second = ix({ options: { bet: '50' } });
  await bj.execute(second);
  assert.match(said(second), /already have a hand in progress/);
  assert.equal(await coins(), 900, 'the second bet was not taken');
});

test('blackjack: stand and win, stand and lose', async () => {
  await reset(); await give(1000);
  let { g } = await startHand();
  g.player = [c('10'), c('9')]; g.dealer = [c('10', '♦'), c('8', '♦')];
  const win = await press('stand');
  assert.match(textOf(win.calls[0].p), /\*\*Dealer\*\* `10♦` `8♦` · \*\*18\*\*[\s\S]*You win \*\*🪙 100\*\*![\s\S]*Balance: 🪙 1,100/);
  assert.equal(await coins(), 1100);
  assert.deepEqual(buttonLabels(win.calls[0].p), [], 'no buttons once it is over');
  json(win.calls[0].p);
  assert.equal(bj.games.size, 0);

  ({ g } = await startHand());
  g.player = [c('10'), c('7')]; g.dealer = [c('10', '♦'), c('9', '♦')];
  const lose = await press('stand');
  assert.match(textOf(lose.calls[0].p), /The dealer wins\. You lost \*\*🪙 100\*\*/);
  assert.equal(await coins(), 1000);
});

test('blackjack: hit until bust, hit to exactly 21, push', async () => {
  await reset(); await give(1000);
  let { g } = await startHand();
  g.player = [c('10'), c('6')]; g.dealer = [c('10', '♦'), c('7', '♦')]; g.deck = [c('K')];
  const bust = await press('hit');
  assert.match(textOf(bust.calls[0].p), /Bust! You lost \*\*🪙 100\*\*/);
  assert.equal(await coins(), 900);

  ({ g } = await startHand());
  g.player = [c('10'), c('6')]; g.dealer = [c('10', '♦'), c('7', '♦')]; g.deck = [c('5')];
  const twentyOne = await press('hit'); // 21: stands automatically, the dealer keeps 17
  assert.match(textOf(twentyOne.calls[0].p), /\*\*You\*\* `10♠` `6♠` `5♠` · \*\*21\*\*[\s\S]*You win \*\*🪙 100\*\*/);

  ({ g } = await startHand());
  g.player = [c('10'), c('8')]; g.dealer = [c('10', '♦'), c('8', '♦')];
  const push = await press('stand');
  assert.match(textOf(push.calls[0].p), /Push\. Your \*\*🪙 100\*\* is returned/);

  ({ g } = await startHand());
  g.player = [c('10'), c('5')]; g.dealer = [c('10', '♦'), c('7', '♦')]; g.deck = [c('2')];
  const keepGoing = await press('hit'); // 17: the hand continues
  assert.match(textOf(keepGoing.calls[0].p), /\*\*You\*\* [\s\S]*\*\*17\*\*/);
  assert.deepEqual(buttonLabels(keepGoing.calls[0].p), ['Hit', 'Stand', 'Double']);
  assert.equal(bj.games.size, 1);
  bj.games.clear();
});

test('blackjack: double down', async () => {
  await reset(); await give(1000);
  let { g } = await startHand(); // 900 left
  g.player = [c('5'), c('6')]; g.dealer = [c('10', '♦'), c('7', '♦')]; g.deck = [c('10')];
  const d = await press('double');
  assert.match(textOf(d.calls[0].p), /Bet: \*\*🪙 200\*\* \(doubled\)[\s\S]*You win \*\*🪙 200\*\*!/);
  assert.equal(await coins(), 1200); // 1000 - 100 - 100 + 400

  await reset(); await give(100);
  ({ g } = await startHand('100')); // 0 left: can't double
  g.player = [c('5'), c('6')];
  const broke = await press('double');
  assert.match(said(broke), /need \*\*🪙 100\*\* more to double/);
  assert.equal(bj.games.size, 1, 'the hand goes on');

  g.player = [c('5'), c('6'), c('2')];
  const late = await press('double');
  assert.match(said(late), /only double on your first move/);
  bj.games.clear();
});

test('blackjack: only the player can press the buttons, and an idle hand stands by itself', async () => {
  await reset(); await give(1000);
  let { g } = await startHand();
  const stranger = await press('hit', { user: 'u2' });
  assert.match(said(stranger), /isn't your hand/);
  assert.equal(g.player.length, 2);

  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    ({ g } = await startHand());
    g.player = [c('10'), c('9')]; g.dealer = [c('10', '♦'), c('8', '♦')];
    const before = (await coins());
    mock.timers.tick(bj.timing.idleMs + 1);
    for (let k = 0; k < 20; k++) await Promise.resolve();
    assert.equal(bj.games.size, 0, 'the hand was finished for them');
    assert.match(textOf(g.interaction.calls.at(-1).p), /You win/);
    assert.equal(await coins(), before + 200);
  } finally {
    mock.timers.reset();
  }
});

// ---------------------------------------------------------------- the shop

test('/shop: staff add roles, members confirm and buy, coins come back if the role fails', async () => {
  const shop = await import('../src/commands/shop.js');
  const role = (id) => guild.roles.cache.get(id);

  const denied = ix({ sub: 'add', options: { role: role('vip'), price: 500 } });
  await shop.execute(denied);
  assert.match(said(denied), /Only staff/);

  const dangerous = ix({ sub: 'add', options: { role: role('mod'), price: 500 }, perms: ADMIN });
  await shop.execute(dangerous);
  assert.match(said(dangerous), /can't be sold: it has the Ban Members permission/);

  const add = ix({ sub: 'add', options: { role: role('vip'), price: 500 }, perms: ADMIN });
  await shop.execute(add);
  assert.match(said(add), /Added to the shop[\s\S]*for sale for \*\*🪙 500\*\*/);
  assert.deepEqual((await getSettings('g1')).shopItems, [{ roleId: 'vip', price: 500 }]);

  await reset(); await give(300);
  const view = ix({ sub: 'view' });
  await shop.execute(view);
  json(view.calls[0].p);
  assert.ok(view.calls[0].p.flags & 64);
  assert.match(textOf(view.calls[0].p), /You have \*\*🪙 300\*\*[\s\S]*<@&vip> · \*\*🪙 500\*\*/);
  assert.deepEqual(customIds(view.calls[0].p), ['shop:pick']);

  const pick = ix({ customId: 'shop:pick', values: ['vip'] });
  await shop.handleSelect(pick);
  json(pick.calls[0].p);
  assert.match(textOf(pick.calls[0].p), /Buy this role\?\n<@&vip> for \*\*🪙 500\*\*/);
  assert.deepEqual(customIds(pick.calls[0].p), ['shop:buy:vip']);

  const poor = ix({ customId: 'shop:buy:vip' });
  await shop.handleButton(poor);
  assert.match(textOf(poor.calls[0].p), /costs \*\*🪙 500\*\* and you have \*\*🪙 300\*\*/);
  assert.ok(!roleSet.has('vip'));

  await give(700); // 1000
  const buy = ix({ customId: 'shop:buy:vip' });
  await shop.handleButton(buy);
  assert.match(textOf(buy.calls[0].p), /Purchase complete[\s\S]*bought <@&vip> for \*\*🪙 500\*\*[\s\S]*🪙 500 left/);
  assert.ok(roleSet.has('vip'));
  assert.equal(await coins(), 500);

  const own = ix({ customId: 'shop:buy:vip' });
  await shop.handleButton(own);
  assert.match(textOf(own.calls[0].p), /already have/);
  assert.equal(await coins(), 500, 'not charged twice');

  // the role can't be given (Discord says no): the coins come back
  roleSet.delete('vip');
  const failing = ix({ customId: 'shop:buy:vip', member: { roles: { cache: { has: () => false }, add: async () => { throw new Error('Missing Permissions'); } } } });
  await shop.handleButton(failing);
  assert.match(textOf(failing.calls[0].p), /weren't charged/);
  assert.equal(await coins(), 500);

  const remove = ix({ sub: 'remove', options: { role: role('vip') }, perms: ADMIN });
  await shop.execute(remove);
  assert.match(said(remove), /no longer for sale/);
  const gone = ix({ customId: 'shop:buy:vip' });
  await shop.handleButton(gone);
  assert.match(textOf(gone.calls[0].p), /isn't for sale anymore/);
});

// ---------------------------------------------------------------- earning and showing coins

test('chatting earns a few coins, at most once a minute', async () => {
  const { onMessage } = await import('../src/lib/activity.js');
  const member = { id: 'chatter', guild: { id: 'g1', ownerId: 'o', roles: { cache: new Map() }, members: { me: { roles: { highest: { position: 5 } } } } }, manageable: false, roles: { cache: { has: () => false } }, nickname: null, displayName: 'c', user: { username: 'c' } };
  const msg = () => ({
    inGuild: () => true, guildId: 'g1', webhookId: null, system: false, member, guild: member.guild, content: 'hello',
    channel: { send: async () => {}, id: 'ch' }, author: person('chatter'), reply: async () => ({ delete: async () => {} }),
  });
  await onMessage(msg());
  const first = await coins('chatter');
  assert.ok(first >= E.CHAT_COINS[0] && first <= E.CHAT_COINS[1], `earned ${first}`);
  await onMessage(msg()); // straight away: no XP and no coins
  assert.equal(await coins('chatter'), first);
});

test('/leaderboard has a coins board', async () => {
  const lb = await import('../src/commands/leaderboard.js');
  await reset('u1'); await reset('u2');
  await give(900, 'u1'); await give(5000, 'rich'); await store.stats.set('g1', 'rich', { coins: 5000 });
  const i = ix({ customId: 'leaderboard:coins' });
  i.guild = { ...guild, name: 'Wobble League', iconURL: () => 'https://cdn.discordapp.com/i.png' };
  await lb.handleButton(i);
  const t = card({ calls: [{ p: i.calls[0].p }] });
  assert.match(t, /🪙 Richest members/);
  assert.match(t, /🥇 <@rich> · \*\*🪙 5,000\*\*[\s\S]*<@u1> · \*\*🪙 900\*\*/);
  assert.deepEqual(buttonLabels(i.calls[0].p), ['Levels', 'Streaks', 'Coins']);
});
