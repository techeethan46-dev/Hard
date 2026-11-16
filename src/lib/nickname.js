// Adds/updates the streak badge at the end of a nickname: "Superman [12🔥]".
const BADGE = /\s*\[\d+🔥\]$/u;
const MAX = 32;

export const stripBadge = (name) => (name ?? '').replace(BADGE, '');

export function withBadge(name, streak) {
  const badge = streak > 0 ? ` [${streak}🔥]` : '';
  const base = stripBadge(name).slice(0, MAX - badge.length).trimEnd();
  return `${base}${badge}`;
}

/** Puts the right badge on a member's nickname. Silently skips people the bot can't rename. */
export async function setStreakBadge(member, streak) {
  if (!member || member.id === member.guild.ownerId || !member.manageable) return false;
  const current = member.nickname ?? member.displayName;
  const next = withBadge(current, streak);
  if (next === (member.nickname ?? '')) return false;
  // Removing the badge from someone who had no nickname before: clear it instead of freezing their name.
  const plain = member.user?.globalName ?? member.user?.username;
  const value = streak === 0 && next === plain ? null : next;
  if (value === member.nickname) return false;
  await member.setNickname(value, streak ? `Chat streak: ${streak} days` : 'Chat streak ended');
  return true;
}

// ---------------------------------------------------------------- AFK tag: "[AFK] Superman [12🔥]"
const AFK = /^\[AFK\]\s*/i;
const AFK_TAG = '[AFK] ';
export const stripAfk = (name) => (name ?? '').replace(AFK, '');

export function withAfk(name, on) {
  const badge = (name ?? '').match(BADGE)?.[0] ?? '';
  const core = stripBadge(stripAfk(name));
  const prefix = on ? AFK_TAG : '';
  return `${prefix}${core.slice(0, MAX - prefix.length - badge.length).trimEnd()}${badge}`;
}

/** Adds or removes the [AFK] tag. Skips people the bot can't rename. */
export async function setAfkTag(member, on) {
  if (!member || member.id === member.guild.ownerId || !member.manageable) return false;
  const next = withAfk(member.nickname ?? member.displayName, on);
  const plain = member.user?.globalName ?? member.user?.username;
  const value = !on && next === plain ? null : next;
  if (value === member.nickname) return false;
  await member.setNickname(value, on ? 'AFK' : 'Back from AFK');
  return true;
}
