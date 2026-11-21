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
  ok('all', 1_000_000, 1_000_000); // no maximum: all means everything
  ok(' 50 ', 100, 50);
  for (const bad of ['', 'abc', '-5', '5 coins', '1e3', '0x10']) assert.match(E.parseBet(bad, 1000).error, /Type a number/, bad);
  assert.match(E.parseBet('5', 1000).error, /smallest bet is 🪙 10/);
  assert.match(E.parseBet('all', 3).error, /smallest bet/);
  ok('60k', 1_000_000, 60_000); // no maximum
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
  const follow = [];
  const rec = (kind) => async (p) => { calls.push({ kind, p }); };
  const o = opts.options ?? {};
  return {
    calls, follow, followUp: async (p) => { follow.push(p); return { id: `f${follow.length}` }; }, guild, guildId: 'g1', user: person(opts.user ?? 'u1'), member: opts.member ?? me, memberPermissions: opts.perms ?? NONE,
    options: {
      getUser: (k) => o[k] ?? null, getString: (k) => o[k] ?? null, getInteger: (k) => o[k] ?? null, getRole: (k) => o[k] ?? null,
      getSubcommand: () => opts.sub,
    },
    customId: opts.customId, values: opts.values, message: opts.message ?? { id: opts.messageId ?? 'm1' },
    fields: { getTextInputValue: (k) => (opts.fields ?? {})[k] ?? '' }, showModal: rec('showModal'),
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
  assert.match(card(ok), /Coins sent[\s\S]*sent \*\*🪙 120\*\* to <@u2>[\s\S]*received \*\*🪙 66\*\* after the \*\*🪙 54\*\* tax[\s\S]*🪙 180 left/);
  assert.equal(await coins('u1'), 180);
  assert.equal(await coins('u2'), 66); // 45% tax
  assert.equal((await store.bank.get('g1')).coins >= 54, true);

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
  assert.match(said(win), /You won \*\*🪙 100\*\*![\s\S]*Tax: \*\*🪙 45\*\* went to the bank[\s\S]*Balance: 🪙 1,055/);
  assert.equal(await coins(), 1055); // 45% tax on the 100 profit

  force(0);
  const lose = ix({ options: { bet: '100', side: 'tails' } });
  await flipCmd.execute(lose);
  assert.match(said(lose), /You lost \*\*🪙 100\*\*[\s\S]*Balance: 🪙 955/);
  assert.equal(await coins(), 955);

  force(1); // tails
  const half = ix({ options: { bet: 'half', side: 'tails' } });
  await flipCmd.execute(half);
  assert.equal(await coins(), 1217); // bet 477, won 954 back, 215 tax on the 477 profit
  restore();

  const broke = ix({ options: { bet: '999999', side: 'heads' } });
  await flipCmd.execute(broke);
  assert.match(said(broke), /Not enough coins/);
  const poor = ix({ options: { bet: '40k', side: 'heads' } });
  await flipCmd.execute(poor);
  assert.match(said(poor), /Not enough coins[\s\S]*only have \*\*🪙 1,217\*\*/);
  assert.equal(await coins(), 1217, 'a refused bet costs nothing');
});

test('/slots: triple pays, pair returns the bet, nothing loses', async () => {
  const slots = await import('../src/commands/slots.js');
  await reset(); await give(1000);

  force(0, 0, 0);
  const triple = ix({ options: { bet: '100' } });
  await slots.execute(triple);
  assert.match(card(triple), /🍒  ┃  🍒  ┃  🍒/);
  assert.match(said(triple), /Three 🍒 · \*\*4×\*\*, you won \*\*🪙 300\*\*!/);
  assert.equal(await coins(), 1165); // 300 profit, 135 tax

  force(99, 99, 99);
  const jackpot = ix({ options: { bet: '10' } });
  await slots.execute(jackpot);
  assert.match(said(jackpot), /JACKPOT[\s\S]*500×/);
  assert.equal(await coins(), 1165 - 10 + 5000 - E.taxOn(4990));

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
  assert.match(textOf(win.calls[1].p), /bet on 🔵 \*\*Blue\*\* · it landed on 🔵 \*\*Blue\*\*[\s\S]*You won \*\*🪙 170\*\*![\s\S]*Balance: 🪙 1,093/);
  assert.equal(await coins(), 1093); // 100 bet, 270 back, 77 tax on the 170 profit
  json(win.calls[1].p);

  // tapping the same round again does nothing
  const again = ix({ customId: 'roulette:blue:100:u1', messageId: 'r1' });
  await roulette.handleButton(again);
  assert.match(said(again), /already started/);
  assert.equal(await coins(), 1093);

  force(2); // green
  const lose = ix({ customId: 'roulette:red:100:u1', messageId: 'r2' });
  await roulette.handleButton(lose);
  restore();
  assert.match(textOf(lose.calls[1].p), /landed on 🟢 \*\*Green\*\*[\s\S]*You lost \*\*🪙 100\*\*/);
  assert.equal(await coins(), 993);

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
  assert.match(textOf(win.calls[0].p), /\*\*Dealer\*\* `10♦` `8♦` · \*\*18\*\*[\s\S]*You win \*\*🪙 100\*\*![\s\S]*Balance: 🪙 1,055/);
  assert.equal(await coins(), 1055); // 45 tax
  assert.deepEqual(buttonLabels(win.calls[0].p), [], 'no buttons once it is over');
  json(win.calls[0].p);
  assert.equal(bj.games.size, 0);

  ({ g } = await startHand());
  g.player = [c('10'), c('7')]; g.dealer = [c('10', '♦'), c('9', '♦')];
  const lose = await press('stand');
  assert.match(textOf(lose.calls[0].p), /The dealer wins\. You lost \*\*🪙 100\*\*/);
  assert.equal(await coins(), 955);
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
  assert.equal(await coins(), 1110); // 1000 - 100 - 100 + 400 - 90 tax

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
    assert.equal(await coins(), before + 200 - 45);
  } finally {
    mock.timers.reset();
  }
});

// ---------------------------------------------------------------- the shop

test('/shop: staff add roles, members confirm and buy, coins come back if the role fails', async () => {
  const shop = await import('../src/commands/shop.js');
  const role = (id) => guild.roles.cache.get(id);

  // Staff put roles on sale in /economy setup (tested below); here the shop starts with one role for sale.
  await updateSettings('g1', { shopItems: [{ roleId: 'vip', price: 500 }] });

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

  await updateSettings('g1', { shopItems: [] }); // staff took it off sale
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
  // 2-5 coins, minus the 45% tax (which goes to the bank)
  assert.ok(first >= 1 && first <= 3, `earned ${first}`);
  assert.ok((await store.bank.get('g1')).coins > 0);
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

// ---------------------------------------------------------------- /economy setup and daily boost roles

test('/economy setup: one screen sets price and daily boost, the best boost counts, the shop shows it', async () => {
  const eco = await import('../src/commands/economy.js');
  const daily = await import('../src/commands/daily.js');
  const shop = await import('../src/commands/shop.js');
  for (const id of ['bronze', 'silver', 'gold']) {
    guild.roles.cache.set(id, { id, name: id, position: 1, permissions: new PermissionsBitField(0n), managed: false, toString: () => `<@&${id}>` });
  }

  const open = ix({ sub: 'setup', perms: ADMIN });
  await eco.execute(open);
  assert.ok(open.calls[0].p.flags & 64);
  assert.match(textOf(open.calls[0].p), /Economy setup[\s\S]*Nothing yet/);
  assert.deepEqual(customIds(open.calls[0].p), ['economy:pick']);

  // Members can't use the wizard's menus.
  const sneaky = ix({ customId: 'economy:pick', values: ['gold'] });
  await eco.handleSelect(sneaky);
  assert.match(said(sneaky), /Manage Server/);

  // Picking a role opens the price + boost form.
  const pick = ix({ customId: 'economy:pick', values: ['gold'], perms: ADMIN });
  await eco.handleSelect(pick);
  assert.equal(pick.calls[0].kind, 'showModal');
  assert.equal(pick.calls[0].p.toJSON().custom_id, 'economy:item:gold');

  const save = async (id, price, percent) => {
    const m = ix({ customId: `economy:item:${id}`, fields: { price, percent }, perms: ADMIN });
    await eco.handleModal(m);
    return m;
  };
  await save('gold', '30,000', '100');
  await save('bronze', '1500', '20');
  const last = await save('silver', '8000', '50');
  assert.match(textOf(last.calls[0].p), /<@&bronze> · \*\*🪙 1,500\*\* · ⚡ \*\*\+20%\*\* daily \(🪙 300\)[\s\S]*<@&gold> · \*\*🪙 30,000\*\* · ⚡ \*\*\+100%\*\* daily \(🪙 500\)/);
  assert.deepEqual((await getSettings('g1')).shopItems, [
    { roleId: 'bronze', price: 1500 }, { roleId: 'silver', price: 8000 }, { roleId: 'gold', price: 30000 },
  ]);
  assert.deepEqual((await getSettings('g1')).dailyBoosts, [
    { roleId: 'bronze', percent: 20 }, { roleId: 'silver', percent: 50 }, { roleId: 'gold', percent: 100 },
  ]);

  // Bad numbers and unsafe roles are refused with a message, and nothing is saved.
  for (const [price, percent, re] of [['abc', '', /price must be/], ['0', '', /price must be/], ['100', '5000', /boost must be/], ['100', 'x', /boost must be/]]) {
    const bad = await save('silver', price, percent);
    assert.match(textOf(bad.calls[0].p), re);
  }
  const unsafe = await save('mod', '100', '');
  assert.match(textOf(unsafe.calls[0].p), /can't be sold: it has the Ban Members permission/);
  assert.equal((await getSettings('g1')).shopItems.length, 3);

  // Daily: Bronze + Gold together pay +100%, not +120%; nobody with no boost role gets 250.
  const holds = (...ids) => ({ roles: { cache: { has: (r) => ids.includes(r) } } });
  const both = ix({ user: 'b1', member: holds('bronze', 'gold') });
  await daily.execute(both);
  assert.match(card(both), /You got \*\*🪙 500\*\*![\s\S]*\+100%\*\* role boost/);
  assert.equal(await coins('b1'), 500);
  const plain = ix({ user: 'b2', member: holds() });
  await daily.execute(plain);
  assert.match(card(plain), /You got \*\*🪙 250\*\*!/);
  assert.doesNotMatch(said(plain), /boost/);

  // The shop shows the perk.
  const view = ix({ member: holds() });
  await shop.execute(view);
  assert.match(said(view), /<@&silver> · \*\*🪙 8,000\*\* · ⚡ \+50% daily/);

  // Setting 0 removes only the boost; Remove takes the role out of both lists.
  await save('bronze', '1500', '0');
  assert.deepEqual((await getSettings('g1')).dailyBoosts.map((b) => b.roleId), ['silver', 'gold']);
  const rm = ix({ customId: 'economy:remove', values: ['gold'], perms: ADMIN });
  await eco.handleSelect(rm);
  assert.deepEqual((await getSettings('g1')).shopItems.map((x) => x.roleId), ['bronze', 'silver']);
  assert.deepEqual((await getSettings('g1')).dailyBoosts.map((b) => b.roleId), ['silver']);
  await updateSettings('g1', { shopItems: [], dailyBoosts: [] });
});

// ---------------------------------------------------------------- the bank

const bankLib = await import('../src/lib/bank.js');
const bankCmd = await import('../src/commands/bank.js');
const { totalXpFor } = await import('../src/lib/levels.js');
const setBank = async (n) => { const cur = (await store.bank.get('g1')).coins; await store.bank.add('g1', n - cur); };
const bankCoins = async () => (await store.bank.get('g1')).coins;
const isPublic = (i) => !(i.calls.at(-1).p.flags & 64);

test('the bank starts with 100,000 coins in every server, once', async () => {
  assert.equal((await store.bank.get('fresh-server')).coins, 100_000);
  await store.bank.add('fresh-server', -40_000);
  assert.equal((await store.bank.get('fresh-server')).coins, 60_000, 'not given again');
  assert.equal(await store.bank.take('fresh-server', 1_000_000), 60_000, 'it never goes below zero');
});

test('tax: 45% of chat coins and /pay goes to the bank, /daily is untaxed', () => {
  assert.equal(E.taxOn(100), 45);
  assert.equal(E.taxOn(3), 1);
  assert.equal(E.taxOn(0), 0);
});

test('/daily is paid by the bank first, and made up when the bank is short', async () => {
  const daily = await import('../src/commands/daily.js');
  await setBank(100_000);
  const a = ix({ user: 'dA', member: { roles: { cache: { has: () => false } } } });
  await daily.execute(a);
  assert.equal(await coins('dA'), 250);
  assert.equal(await bankCoins(), 99_750);
  assert.match(card(a), /250 of it came from the bank/);

  await setBank(100); // short: the bank pays 100, the other 150 is created new
  const b = ix({ user: 'dB', member: { roles: { cache: { has: () => false } } } });
  await daily.execute(b);
  assert.equal(await coins('dB'), 250, 'nobody is refused');
  assert.equal(await bankCoins(), 0);
});

test('after a win: pay tax, or dodge it and get caught or get away', async () => {
  const flipCmd = await import('../src/commands/coinflip.js');
  const win = async (user = 'u1') => { force(0); const i = ix({ user, options: { bet: '100', side: 'heads' } }); await flipCmd.execute(i); restore(); return i; };
  const idOf = (i) => customIds(i.follow[0])[0].split(':')[2];
  const press = async (action, i, user = 'u1') => { const p = ix({ user, customId: `bank:${action}:${idOf(i)}` }); await bankCmd.handleButton(p); return p; };
  await setBank(100_000);

  // the buttons show up after a win, only for the winner, and never after a loss
  await reset(); await give(1000);
  let i = await win();
  assert.deepEqual(customIds(i.follow[0]), [`bank:pay:${idOf(i)}`, `bank:skip:${idOf(i)}`]);
  assert.match(textOf(i.follow[0]), /45%[\s\S]*🪙 45[\s\S]*60%[\s\S]*80%/);
  assert.ok(i.follow[0].flags & 64, 'private to the player');
  force(0); const lost = ix({ options: { bet: '100', side: 'tails' } }); await flipCmd.execute(lost); restore();
  assert.equal(lost.follow.length, 0);

  // someone else can't answer for you
  const thief = await press('skip', i, 'u2');
  assert.match(said(thief), /belongs to someone else/);

  // Pay tax: nothing changes
  await reset(); await give(1000);
  i = await win();
  const kept = await coins();
  const paid = await press('pay', i);
  assert.match(textOf(paid.calls[0].p), /You paid \*\*🪙 45\*\* tax/);
  assert.equal(await coins(), kept);
  const late = await press('pay', i);
  assert.match(textOf(late.calls[0].p), /has ended/);

  // Don't pay, caught (60%): the bank takes 80% of the coins
  await reset(); await give(1000);
  i = await win();
  const wallet = await coins();
  const bankBefore = await bankCoins();
  force(0);
  const caught = await press('skip', i);
  restore();
  assert.match(textOf(caught.calls[0].p), new RegExp(`Caught[\\s\\S]*🪙 ${Math.floor(wallet * 0.8)}`));
  assert.equal(await coins(), wallet - Math.floor(wallet * 0.8));
  assert.equal(await bankCoins(), bankBefore + Math.floor(wallet * 0.8));

  // Don't pay, not caught: the tax comes back
  await reset(); await give(1000);
  i = await win();
  const before = await coins();
  force(99);
  const away = await press('skip', i);
  restore();
  assert.match(textOf(away.calls[0].p), /Not caught/);
  assert.equal(await coins(), before + 45);

  // Over 100,000 coins: it asks "are you sure?" first, and Cancel pays the tax
  await reset(); await give(200_000);
  i = await win();
  const rich = await coins();
  const ask = await press('skip', i);
  assert.match(textOf(ask.calls[0].p), /Are you sure[\s\S]*60%[\s\S]*80%/);
  assert.deepEqual(customIds(ask.calls[0].p), [`bank:risk:${idOf(i)}`, `bank:pay:${idOf(i)}`]);
  assert.equal(await coins(), rich, 'nothing happens until they confirm');
  force(0);
  const risk = await press('risk', i);
  restore();
  assert.match(textOf(risk.calls[0].p), /Caught/);
  assert.equal(await coins(), rich - Math.floor(rich * 0.8));

  await reset(); await give(200_000);
  i = await win();
  await press('skip', i);
  const cancel = await press('pay', i);
  assert.match(textOf(cancel.calls[0].p), /You paid/);
});

test('after a win: no answer in time means you pay, and the buttons go away', async () => {
  const flipCmd = await import('../src/commands/coinflip.js');
  await reset(); await give(1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    force(0);
    const i = ix({ options: { bet: '100', side: 'heads' } });
    await flipCmd.execute(i);
    restore();
    const id = customIds(i.follow[0])[0].split(':')[2];
    mock.timers.tick(bankLib.timing.choiceMs + 1);
    for (let k = 0; k < 10; k++) await Promise.resolve();
    const edit = i.calls.at(-1);
    assert.equal(edit.kind, 'editReply');
    assert.equal(edit.p.message, 'f1', 'edits the private message');
    assert.match(textOf(edit.p), /You paid \*\*🪙 45\*\* tax/);
    assert.deepEqual(customIds(edit.p), []);
    const late = ix({ customId: `bank:skip:${id}` });
    await bankCmd.handleButton(late);
    assert.match(textOf(late.calls[0].p), /has ended/);
    assert.equal(await coins(), 1055);
  } finally {
    mock.timers.reset();
  }
});

test('/bank view shows the fund for everyone', async () => {
  await setBank(123_456);
  const v = ix({ sub: 'view' });
  await bankCmd.execute(v);
  assert.ok(isPublic(v));
  assert.match(card(v), /The Server Bank\n# 🪙 123,456/);
  assert.match(said(v), /45%/);
});

test('/bank rob: 5% chance, fee of 10% (at least 5,000) goes to the bank, once every 24 hours', async () => {
  const rob = (user = 'u1') => ix({ sub: 'rob', user });
  await setBank(100_000);

  await reset(); await give(4_000);
  const broke = rob(); await bankCmd.execute(broke);
  assert.match(said(broke), /costs \*\*🪙 5,000\*\*[\s\S]*have \*\*🪙 4,000\*\*/);
  assert.equal(await coins(), 4_000);
  assert.equal((await store.stats.get('g1', 'u1')).robAt, undefined, 'no cooldown started');

  await give(20_000); // 24,000: the fee is the 5,000 minimum
  force(50);
  const fail = rob(); await bankCmd.execute(fail);
  restore();
  assert.match(card(fail), /Busted[\s\S]*\*\*🪙 5,000\*\* fee went into the bank/);
  assert.ok(isPublic(fail), 'everyone sees it');
  assert.equal(await coins(), 19_000);
  assert.equal(await bankCoins(), 105_000);

  const again = rob(); await bankCmd.execute(again);
  assert.match(said(again), /already tried today/);
  assert.equal(await coins(), 19_000, 'no second fee');

  // 24 hours later: allowed again. A rich robber pays 10% of the wallet, and wins 30% of the bank.
  await reset('u3'); await give(100_000, 'u3');
  force(0);
  const win = rob('u3'); await bankCmd.execute(win);
  restore();
  assert.match(card(win), /THE BANK WAS ROBBED[\s\S]*🪙 30,000/); // 30% of 115,000 is 34,500, but the most you can take is 30,000
  assert.ok(isPublic(win));
  assert.equal(await coins('u3'), 100_000 - 10_000 + 30_000);
  assert.equal(await bankCoins(), 115_000 - 30_000);
  const v = ix({ sub: 'view' }); await bankCmd.execute(v);
  assert.match(said(v), /Last robbery: <@u3> got away with 🪙 30,000/);

  await store.stats.set('g1', 'u1', { robAt: Date.now() - 25 * 3_600_000 });
  force(50);
  const next = rob(); await bankCmd.execute(next);
  restore();
  assert.match(card(next), /Busted/);

  await setBank(500);
  const empty = rob('u3'); await bankCmd.execute(empty);
  assert.match(said(empty), /Almost empty/);
});

test('/bank loan: needs a linked account and level 5, limited by the bank, 10% interest', async () => {
  const loan = (amount, user = 'L1') => ix({ sub: 'loan', user, options: { amount } });
  const repay = (amount, user = 'L1') => ix({ sub: 'repay', user, options: { amount } });
  await setBank(100_000);

  const nolink = loan(500); await bankCmd.execute(nolink);
  assert.match(said(nolink), /Link your Roblox account/);
  await store.links.set('L1', { robloxId: 1, username: 'x' });
  const low = loan(500); await bankCmd.execute(low);
  assert.match(said(low), /level 5\*\*[\s\S]*level 0/);
  await store.stats.set('g1', 'L1', { xp: totalXpFor(5) });

  const tiny = loan(50); await bankCmd.execute(tiny);
  assert.match(said(tiny), /smallest loan is \*\*🪙 100\*\*/);
  const big = loan(3_000); await bankCmd.execute(big);
  assert.match(said(big), /up to \*\*🪙 2,000\*\*/);
  await setBank(5_000);
  const share = loan(600); await bankCmd.execute(share);
  assert.match(said(share), /up to \*\*🪙 500\*\*[\s\S]*10% of the bank/);

  await setBank(100_000);
  const ok = loan(1_000); await bankCmd.execute(ok);
  assert.match(card(ok), /Loan approved[\s\S]*borrowed \*\*🪙 1,000\*\*[\s\S]*Pay back \*\*🪙 1,100\*\* \(10% extra\)/);
  assert.equal(await coins('L1'), 1_000);
  assert.equal(await bankCoins(), 99_000);
  const doc = await store.stats.get('g1', 'L1');
  assert.equal(doc.loan.owed, 1_100);
  assert.ok(Math.abs(doc.loan.dueAt - (Date.now() + 3 * 86_400_000)) < 5_000);

  const second = loan(200); await bankCmd.execute(second);
  assert.match(said(second), /still owe \*\*🪙 1,100\*\*/);
  assert.equal(await bankCoins(), 99_000, 'nothing was taken from the bank');

  const part = repay(300); await bankCmd.execute(part);
  assert.match(said(part), /paid \*\*🪙 300\*\*[\s\S]*still owe \*\*🪙 800\*\*/);
  assert.equal(await bankCoins(), 99_300);
  const all = repay(); await bankCmd.execute(all); // only 700 coins left: pays what they can
  assert.match(said(all), /paid \*\*🪙 700\*\*[\s\S]*still owe \*\*🪙 100\*\*/);
  await give(500, 'L1');
  const done = repay(); await bankCmd.execute(done);
  assert.match(said(done), /Your loan is paid off/);
  assert.equal(await bankCoins(), 100_100, 'the bank got its money plus 10% interest');
  const none = repay(); await bankCmd.execute(none);
  assert.match(said(none), /don't have a loan/);
});

test('an overdue loan takes half of every coin you receive and blocks games and the shop', async () => {
  const flipCmd = await import('../src/commands/coinflip.js');
  const shop = await import('../src/commands/shop.js');
  await setBank(100_000);
  await reset('L2'); await give(1_000, 'L2');
  await store.stats.set('g1', 'L2', { loan: { owed: 600, dueAt: Date.now() - 1000, principal: 500 } });

  const got = await bankLib.credit('g1', 'L2', 100);
  assert.equal(got.garnished, 50);
  assert.equal(await coins('L2'), 1_050);
  assert.equal((await store.stats.get('g1', 'L2')).loan.owed, 550);
  assert.equal(await bankCoins(), 100_050);

  const game = ix({ user: 'L2', options: { bet: '100', side: 'heads' } });
  await flipCmd.execute(game);
  assert.match(said(game), /Loan overdue[\s\S]*owe \*\*🪙 550\*\*/);
  assert.equal(await coins('L2'), 1_050, 'no bet was taken');

  await updateSettings('g1', { shopItems: [{ roleId: 'vip', price: 10 }] });
  const buy = ix({ user: 'L2', customId: 'shop:buy:vip' });
  await shop.handleButton(buy);
  assert.match(textOf(buy.calls[0].p), /Loan overdue/);
  await updateSettings('g1', { shopItems: [] });

  // not overdue yet: nothing is taken and games work
  await store.stats.set('g1', 'L2', { loan: { owed: 600, dueAt: Date.now() + 86_400_000, principal: 500 } });
  assert.equal((await bankLib.credit('g1', 'L2', 100)).garnished, 0);
  force(0);
  const ok = ix({ user: 'L2', options: { bet: '100', side: 'heads' } });
  await flipCmd.execute(ok);
  restore();
  assert.match(said(ok), /You won/);
});

test('a robbery below the cap takes exactly 30% of the bank', async () => {
  await setBank(50_000);
  await reset('u5'); await give(10_000, 'u5');
  force(0);
  const i = ix({ sub: 'rob', user: 'u5' });
  await bankCmd.execute(i);
  restore();
  // fee 5,000 -> bank 55,000 -> 30% = 16,500 (under the 30,000 cap)
  assert.match(card(i), /THE BANK WAS ROBBED[\s\S]*🪙 16,500/);
  assert.equal(await bankCoins(), 55_000 - 16_500);
});
