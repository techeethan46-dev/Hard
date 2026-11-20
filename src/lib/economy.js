// The coin economy and its games. Coins are fake: they have no link to Robux or real money.
import { randomInt } from 'node:crypto';

export const DAILY_COINS = 250;
export const CHAT_COINS = [2, 5]; // earned (min, max) on each message that also earns XP, so at most once a minute
export const MIN_BET = 10;
export const MAX_BET = 50_000;
export const COINFLIP_PAYOUT = 2; // double or nothing
export const ROULETTE_PAYOUT = 2.7; // three colors, so a fair payout would be 3
export const BLACKJACK_NATURAL_PAYOUT = 2.5; // 3 to 2

/** The random numbers every game uses. Tests replace `int` to force an outcome. */
export const rng = { int: (n) => randomInt(n) };

export const randomCoins = () => CHAT_COINS[0] + rng.int(CHAT_COINS[1] - CHAT_COINS[0] + 1);
export const fmt = (n) => `🪙 ${Number(n ?? 0).toLocaleString('en-US')}`;
/** The best daily boost (percent) among the roles this member holds; 0 when none. Boosts do not add together. */
export const dailyBoostPercent = (member, boosts = []) =>
  boosts.reduce((best, b) => (member?.roles?.cache?.has?.(b.roleId) ? Math.max(best, b.percent) : best), 0);
/** The /daily reward with a boost percent applied (rounded down). */
export const dailyReward = (percent = 0) => Math.floor(DAILY_COINS * (100 + percent) / 100);
export const payout = (bet, multiplier) => Math.floor(bet * multiplier);

/** "500", "1.5k", "2m", "1,000", "all" or "half" -> { amount } or { error }. */
export function parseBet(input, balance) {
  const s = String(input ?? '').trim().toLowerCase().replace(/[,_\s]/g, '');
  let amount;
  if (s === 'all' || s === 'max') amount = Math.min(balance, MAX_BET);
  else if (s === 'half') amount = Math.floor(balance / 2);
  else {
    const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
    if (!m) return { error: 'Type a number like `500`, `1.5k`, or `all` / `half`.' };
    amount = Math.floor(Number(m[1]) * ({ k: 1000, m: 1_000_000 }[m[2]] ?? 1));
  }
  if (amount < MIN_BET) return { error: `The smallest bet is ${fmt(MIN_BET)}.` };
  if (amount > MAX_BET) return { error: `The biggest bet is ${fmt(MAX_BET)}.` };
  return { amount };
}

// ---------------------------------------------------------------- coinflip

export const flip = () => (rng.int(2) === 0 ? 'heads' : 'tails');

// ---------------------------------------------------------------- slots

// w = how often it shows up, x = what three of them pay (times the bet). Two matching symbols give the bet back.
export const SLOT_SYMBOLS = [
  { e: '🍒', w: 30, x: 4 }, { e: '🍋', w: 25, x: 6 }, { e: '🍊', w: 20, x: 10 }, { e: '🍇', w: 15, x: 20 },
  { e: '🔔', w: 7, x: 60 }, { e: '💎', w: 2, x: 200 }, { e: '7️⃣', w: 1, x: 500 },
];
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((n, s) => n + s.w, 0);

function pickSymbol() {
  let r = rng.int(SLOT_TOTAL);
  for (const s of SLOT_SYMBOLS) {
    if (r < s.w) return s;
    r -= s.w;
  }
  return SLOT_SYMBOLS[0];
}

/** { reels: [emoji x3], multiplier, kind: 'triple' | 'pair' | 'none', symbol } */
export function spinSlots() {
  const picks = [pickSymbol(), pickSymbol(), pickSymbol()];
  const reels = picks.map((s) => s.e);
  if (reels[0] === reels[1] && reels[1] === reels[2]) return { reels, multiplier: picks[0].x, kind: 'triple', symbol: picks[0].e };
  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) return { reels, multiplier: 1, kind: 'pair' };
  return { reels, multiplier: 0, kind: 'none' };
}

/** What slots pays back on average per coin bet, worked out exactly (about 0.87, so the house keeps a little). */
export function slotsReturn() {
  return SLOT_SYMBOLS.reduce((sum, { w, x }) => {
    const p = w / SLOT_TOTAL;
    return sum + p ** 3 * x + 3 * p ** 2 * (1 - p) * 1;
  }, 0);
}

// ---------------------------------------------------------------- roulette

export const COLORS = [
  { id: 'red', emoji: '🔴', label: 'Red' },
  { id: 'blue', emoji: '🔵', label: 'Blue' },
  { id: 'green', emoji: '🟢', label: 'Green' },
];
export const spinRoulette = () => COLORS[rng.int(COLORS.length)];

// ---------------------------------------------------------------- blackjack

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export function newDeck() {
  const deck = SUITS.flatMap((s) => RANKS.map((r) => ({ r, s })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck; // draw with deck.pop()
}

const cardValue = (c) => (c.r === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));

/** Best total: aces count 11 unless that would bust, then 1. */
export function handValue(hand) {
  let total = hand.reduce((n, c) => n + cardValue(c), 0);
  let aces = hand.filter((c) => c.r === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export const isNatural = (hand) => hand.length === 2 && handValue(hand) === 21;
export const showHand = (hand) => hand.map((c) => `\`${c.r}${c.s}\``).join(' ');

/** The dealer draws until 17 or more (and stands on every 17). */
export function dealerPlay(deck, dealer) {
  while (handValue(dealer) < 17) dealer.push(deck.pop());
  return dealer;
}

/** The result of a finished hand. `bet` is everything wagered (doubled if they doubled). */
export function settle(player, dealer, bet) {
  const pv = handValue(player);
  const dv = handValue(dealer);
  if (isNatural(player) && isNatural(dealer)) return { outcome: 'push', payout: bet };
  if (isNatural(player)) return { outcome: 'blackjack', payout: payout(bet, BLACKJACK_NATURAL_PAYOUT) };
  if (isNatural(dealer) || pv > 21) return { outcome: 'lose', payout: 0 };
  if (dv > 21 || pv > dv) return { outcome: 'win', payout: bet * 2 };
  if (pv === dv) return { outcome: 'push', payout: bet };
  return { outcome: 'lose', payout: 0 };
}
