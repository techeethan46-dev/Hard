// Classic leveling: 15–25 XP per message, at most once a minute.
// XP needed to go from level L to L+1 is 5L² + 50L + 100 (100, 155, 220, 295, ...).

export const XP_COOLDOWN_MS = 60_000;
export const randomXp = () => 15 + Math.floor(Math.random() * 11);
export const xpToNext = (level) => 5 * level * level + 50 * level + 100;

/** { level, into, needed } — `into` is XP earned inside the current level. */
export function levelInfo(xp = 0) {
  let level = 0;
  let rest = Math.max(0, xp);
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  return { level, into: rest, needed: xpToNext(level) };
}

/** Total XP needed to reach a level from zero. */
export function totalXpFor(level) {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l);
  return total;
}
