// Daily chat streaks. Days are calendar days ("YYYY-MM-DD") in the server's timezone.
//
// Streak record: {
//   current, best,           // days in a row, best ever
//   lastDay, startDay,       // last day they chatted, first day of the current run
//   lost, lostLastDay,       // the streak that most recently broke, and its last day (for restores)
//   lostNotified,            // whether we've told them it broke
//   restores: { month, used }
// }

export const RESTORES_PER_MONTH = 3;

export function dayKey(date = new Date(), timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

const toUtc = (key) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
export const addDays = (key, n) => new Date(toUtc(key) + n * 86_400_000).toISOString().slice(0, 10);

const empty = () => ({ current: 0, best: 0, lastDay: null, startDay: null, lost: 0, lostLastDay: null, lostNotified: true, restores: { month: null, used: 0 } });
export const normalize = (s) => ({ ...empty(), ...(s ?? {}), restores: { ...empty().restores, ...(s?.restores ?? {}) } });

/** Restores left this month. */
export function restoresLeft(streak, today) {
  const r = normalize(streak).restores;
  return r.month === today.slice(0, 7) ? Math.max(0, RESTORES_PER_MONTH - r.used) : RESTORES_PER_MONTH;
}

/** Ends a streak that missed a day. Returns the new record, or null if nothing changed. */
export function breakIfStale(streak, today) {
  const s = normalize(streak);
  if (s.current > 0 && s.lastDay && daysBetween(s.lastDay, today) >= 2) {
    return { ...s, lost: s.current, lostLastDay: s.lastDay, lostNotified: false, current: 0, startDay: null };
  }
  return null;
}

/**
 * Someone chatted today. Returns { streak, changed, broke }.
 * `broke` is true when a streak just ended and they haven't been told yet.
 */
export function recordChat(streak, today) {
  let s = normalize(streak);
  if (s.lastDay === today) return { streak: s, changed: false, broke: false };
  s = breakIfStale(s, today) ?? s;

  if (s.current > 0 && daysBetween(s.lastDay, today) === 1) s = { ...s, current: s.current + 1 };
  else s = { ...s, current: 1, startDay: today };

  s = { ...s, lastDay: today, best: Math.max(s.best, s.current) };
  const broke = s.lost > 0 && !s.lostNotified;
  if (broke) s.lostNotified = true;
  return { streak: s, changed: true, broke };
}

/** What restoring would cost: { possible, cost, left, value, reason }. */
export function restoreQuote(streak, today) {
  const s = normalize(streak);
  const left = restoresLeft(s, today);
  if (!s.lost) return { possible: false, cost: 0, left, value: s.current, reason: 'nothing' };
  // Days missed between the old streak and the new one (or today, if they haven't chatted since).
  const resumedOn = s.current > 0 ? s.startDay : today;
  const cost = Math.max(1, daysBetween(s.lostLastDay, resumedOn) - 1);
  const value = s.lost + s.current;
  if (cost > left) return { possible: false, cost, left, value, reason: 'not-enough' };
  return { possible: true, cost, left, value, reason: null };
}

/** Applies a restore (call only when restoreQuote says possible). */
export function applyRestore(streak, today) {
  const s = normalize(streak);
  const q = restoreQuote(s, today);
  if (!q.possible) return null;
  const month = today.slice(0, 7);
  const used = (s.restores.month === month ? s.restores.used : 0) + q.cost;
  return {
    ...s,
    current: q.value,
    best: Math.max(s.best, q.value),
    // If they haven't chatted today yet, count yesterday as covered so chatting today continues the streak.
    lastDay: s.current > 0 ? s.lastDay : addDays(today, -1),
    startDay: addDays(s.lostLastDay, -(s.lost - 1)),
    lost: 0, lostLastDay: null, lostNotified: true,
    restores: { month, used },
  };
}
