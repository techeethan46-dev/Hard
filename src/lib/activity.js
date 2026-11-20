// Runs on every message: gives XP (once a minute) and counts the daily streak (once a day).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { XP_COOLDOWN_MS, levelInfo, randomXp } from './levels.js';
import { setStreakBadge, syncNameTags } from './nickname.js';
import { getAfk } from './afk.js';
import { randomCoins } from './economy.js';
import { getSettings } from './settings.js';
import { store } from './store.js';
import { RESTORES_PER_MONTH, addDays, breakIfStale, daysBetween, dayKey, recordChat, restoreQuote } from './streaks.js';
import { card, colors, divider, footnote, section, text, thumb, v2 } from './ui.js';

const lastXp = new Map(); // "guild:user" -> time of last XP
const chattedOn = new Map(); // "guild:user" -> day already counted for the streak

export const todayFor = (settings) => dayKey(new Date(), settings.streakTimezone || 'UTC');

export async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
  const key = `${message.guildId}:${message.author.id}`;
  const settings = await getSettings(message.guildId);
  const today = todayFor(settings);
  const jobs = [];

  if ((lastXp.get(key) ?? 0) + XP_COOLDOWN_MS <= Date.now()) {
    lastXp.set(key, Date.now());
    jobs.push(giveXp(message, settings));
  }
  if (chattedOn.get(key) !== today) {
    chattedOn.set(key, today);
    jobs.push(countStreak(message, today, settings));
  }
  for (const r of await Promise.allSettled(jobs)) if (r.status === 'rejected') console.error('Activity error:', r.reason);
}

// ---------------------------------------------------------------- levels

async function giveXp(message, settings) {
  const amount = randomXp();
  const doc = await store.stats.addXp(message.guildId, message.author.id, amount);
  await store.stats.addCoins(message.guildId, message.author.id, randomCoins()); // a few coins too, at the same once-a-minute pace
  const before = levelInfo(doc.xp - amount).level;
  const after = levelInfo(doc.xp);
  if (after.level <= before) return;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  const rewards = await grantRewards(member, settings, after.level);
  const gained = rewards.filter((r) => r.level > before);

  const channel = await announceChannel(message, settings);
  await channel.send(levelUpCard(message.author, after, gained))
    .catch((err) => console.error('Level-up message failed:', err.message));
}

/** The "Level up!" message: who, which level, how much to the next one, and any role they unlocked. No progress bar. */
export function levelUpCard(author, after, gained = []) {
  return v2(card(colors.ok,
    section([
      `### 🎉 Level up!`,
      `${author} reached **level ${after.level}**`,
      `-# ${(after.needed - after.into).toLocaleString('en-US')} XP to level ${after.level + 1}`,
    ], thumb(author.displayAvatarURL({ size: 128 }))),
    gained.length ? [divider(), text(gained.map((r) => `🎁 Unlocked <@&${r.roleId}>`))] : null,
  ), { mentions: { users: [author.id] } });
}

/** Gives every reward role at or below this level. Returns the rewards they now qualify for. */
export async function grantRewards(member, settings, level) {
  const earned = (settings.levelRewards ?? []).filter((r) => r.level <= level);
  if (!member) return earned;
  const top = member.guild.members.me?.roles.highest.position ?? 0;
  for (const r of earned) {
    const role = member.guild.roles.cache.get(r.roleId);
    if (role && role.position < top && !member.roles.cache.has(r.roleId)) {
      await member.roles.add(r.roleId, `Reached level ${level}`).catch(() => {});
    }
  }
  return earned;
}

// ---------------------------------------------------------------- streaks

/** Where level-up and streak announcements go: the level-up channel from /setup, else the channel they chatted in. */
async function announceChannel(message, settings) {
  return (settings.levelUpChannel && (await message.guild.channels.fetch(settings.levelUpChannel).catch(() => null))) || message.channel;
}

async function countStreak(message, today, settings) {
  const doc = await store.stats.get(message.guildId, message.author.id);
  const { streak, changed, broke } = recordChat(doc?.streak, today);
  if (!changed) return;
  await store.stats.set(message.guildId, message.author.id, { streak });

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  await setStreakBadge(member, streak.current).catch(() => {});
  const gained = await syncStreakRoles(member, settings, streak.current);
  if (gained.length) {
    const channel = await announceChannel(message, settings);
    await channel.send(streakMilestoneCard(message.author, streak.current, gained))
      .catch((err) => console.error('Streak milestone message failed:', err.message));
  }
  if (broke) await sendBreakNotice(message, streak, today);
}

// ---------------------------------------------------------------- streak roles

/**
 * Gives the streak roles a streak has earned (7 days -> @Week Warrior). Unless the server chose to keep them,
 * roles are taken away again when the streak drops below their days. Returns the rewards newly given.
 */
export async function syncStreakRoles(member, settings, current) {
  const rewards = settings.streakRewards ?? [];
  const gained = [];
  if (!member || !rewards.length) return gained;
  const keep = settings.streakRolesKeep === 'keep';
  const top = member.guild.members.me?.roles.highest.position ?? 0;
  for (const r of rewards) {
    const role = member.guild.roles.cache.get(r.roleId);
    if (!role || role.position >= top) continue;
    const has = member.roles.cache.has(r.roleId);
    if (current >= r.days && !has) {
      if (await member.roles.add(r.roleId, `Reached a ${r.days}-day streak`).then(() => true, () => false)) gained.push(r);
    } else if (current < r.days && has && !keep) {
      await member.roles.remove(r.roleId, 'Streak ended').catch(() => {});
    }
  }
  return gained;
}

export function streakMilestoneCard(author, current, gained) {
  return v2(card(colors.warn,
    section([
      `### 🔥 ${current}-day streak!`,
      `${author} unlocked ${gained.map((r) => `<@&${r.roleId}>`).join(' ')}`,
      '-# Keep chatting every day to keep it going',
    ], thumb(author.displayAvatarURL({ size: 128 }))),
  ), { mentions: { users: [author.id] } });
}

// ---------------------------------------------------------------- nicknames

/**
 * Someone changed their nickname: put the 🔥 badge (and [AFK] tag) back straight away.
 * Without this, a new nickname would stay badge-less until their next message the following day.
 */
export async function restoreNickname(before, after) {
  if (after.user?.bot) return;
  if (!before.partial && before.nickname === after.nickname) return;
  const doc = await store.stats.get(after.guild.id, after.id);
  const today = todayFor(await getSettings(after.guild.id));
  const s = doc?.streak;
  // A streak counts while they chatted today or yesterday (it only ends after a whole missed day).
  const streak = s?.current > 0 && s.lastDay && daysBetween(s.lastDay, today) <= 1 ? s.current : 0;
  const afk = Boolean(await getAfk(after.guild.id, after.id));
  if (!streak && !afk) return;
  await syncNameTags(after, { streak, afk });
}

/** "Your 12🔥 streak ended" with a Restore button. Deletes itself after a minute. */
async function sendBreakNotice(message, streak, today) {
  const q = restoreQuote(streak, today);
  const missed = `${q.cost} day${q.cost === 1 ? '' : 's'}`;
  const msg = await message.reply(v2(card(colors.warn,
    section([
      `### 💔 Your ${streak.lost}🔥 streak ended`,
      q.possible
        ? `You missed **${missed}**. Use ${q.cost === 1 ? 'a restore' : `${q.cost} restores`} to keep going at **${q.value}🔥**.`
        : `You missed **${missed}** and only have **${q.left}** restore${q.left === 1 ? '' : 's'} left this month.`,
    ], thumb(message.author.displayAvatarURL({ size: 128 }))),
    q.possible
      ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`streak:restore:${message.author.id}:notice`).setEmoji('🔥')
          .setLabel(`Restore streak · ${q.left} of ${RESTORES_PER_MONTH} left`).setStyle(ButtonStyle.Success),
      )
      : null,
    footnote(`Each missed day uses 1 restore · ${RESTORES_PER_MONTH} per month · this message disappears in a minute`),
  ), { mentions: { repliedUser: false } })).catch(() => null);
  if (msg) setTimeout(() => msg.delete().catch(() => {}), 60_000);
}

/**
 * Ends streaks for people who skipped a whole day and takes the badge off their name.
 * Runs every few minutes from the ready event.
 */
export async function sweepStreaks(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const settings = await getSettings(guild.id);
      const today = todayFor(settings);
      const stale = await store.stats.staleStreaks(guild.id, addDays(today, -1));
      for (const doc of stale) {
        const broken = breakIfStale(doc.streak, today);
        if (!broken) continue;
        await store.stats.set(guild.id, doc.userId, { streak: broken });
        const member = await guild.members.fetch(doc.userId).catch(() => null);
        await setStreakBadge(member, 0).catch(() => {});
        await syncStreakRoles(member, settings, 0);
      }
    } catch (err) {
      console.error(`Streak sweep failed for ${guild.id}:`, err.message);
    }
  }
  // Forget old cache entries so memory doesn't grow forever.
  if (chattedOn.size > 50_000) chattedOn.clear();
  if (lastXp.size > 50_000) lastXp.clear();
}
