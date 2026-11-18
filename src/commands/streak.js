import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { syncStreakRoles, todayFor } from '../lib/activity.js';
import { setStreakBadge } from '../lib/nickname.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { RESTORES_PER_MONTH, applyRestore, normalize, restoreQuote, restoresLeft } from '../lib/streaks.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('streak')
  .setDescription('Your daily chat streak and restores');

export async function execute(interaction) {
  const settings = await getSettings(interaction.guildId);
  const today = todayFor(settings);
  const doc = await store.stats.get(interaction.guildId, interaction.user.id);
  const s = normalize(doc?.streak);
  const q = restoreQuote(s, today);
  const chattedToday = s.lastDay === today;
  const nextRole = (settings.streakRewards ?? []).filter((r) => r.days > s.current).sort((a, b) => a.days - b.days)[0];

  return interaction.reply(v2(card(s.current ? colors.warn : colors.brand,
    section([
      `### ${s.current ? `🔥 ${s.current} day streak` : '🌱 No streak yet'}`,
      s.current
        ? (chattedToday ? '✅ Today counted. See you tomorrow!' : '⏳ Send a message today to keep it going!')
        : 'Send a message today to start one. Your name gets a 🔥 badge.',
      `-# Best ever: ${s.best} day${s.best === 1 ? '' : 's'}`,
    ], thumb(interaction.user.displayAvatarURL({ size: 128 }))),
    divider(),
    text(
      `🛟 **${restoresLeft(s, today)}/${RESTORES_PER_MONTH}** restores left this month`,
      nextRole ? `🎁 **${nextRole.days} days** unlocks <@&${nextRole.roleId}> · ${nextRole.days - s.current} to go` : null,
      s.lost ? (q.possible
        ? `💔 Your **${s.lost}🔥** streak broke. Restoring costs **${q.cost}** and puts you at **${q.value}🔥**.`
        : `💔 Your **${s.lost}🔥** streak broke. Restoring needs **${q.cost}**, you have **${q.left}**.`) : null,
    ),
    q.possible
      ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`streak:restore:${interaction.user.id}`).setEmoji('🔥')
          .setLabel(`Restore to ${q.value}🔥`).setStyle(ButtonStyle.Success),
      )
      : null,
    footnote(`Chat once a day to grow it · each missed day costs 1 restore · ${RESTORES_PER_MONTH} restores a month`),
  ), { ephemeral: true }));
}

export async function handleButton(interaction) {
  const [, action, ownerId, from] = interaction.customId.split(':');
  if (action !== 'restore') return;
  if (interaction.user.id !== ownerId) return interaction.reply(notice('warn', 'This button is for someone else. Use `/streak` to see yours.'));

  const settings = await getSettings(interaction.guildId);
  const today = todayFor(settings);
  const doc = await store.stats.get(interaction.guildId, interaction.user.id);
  const s = normalize(doc?.streak);
  const q = restoreQuote(s, today);
  if (!q.possible) {
    return interaction.reply(notice('warn', q.reason === 'nothing'
      ? 'There\'s no broken streak to restore.'
      : `Restoring needs ${q.cost} restores and you have ${q.left} left this month.`));
  }

  const restored = applyRestore(s, today);
  await store.stats.set(interaction.guildId, interaction.user.id, { streak: restored });
  await setStreakBadge(interaction.member, restored.current).catch(() => {});
  await syncStreakRoles(interaction.member, settings, restored.current);

  const left = restoresLeft(restored, today);
  const msg = v2(card(colors.ok,
    section([
      `### 🔥 Streak restored!`,
      `You're back at **${restored.current} days**.`,
      `-# ${left} restore${left === 1 ? '' : 's'} left this month`,
    ], thumb(interaction.user.displayAvatarURL({ size: 128 }))),
    footnote(s.current ? 'Keep chatting every day!' : 'Send a message today to keep it going.'),
  ), { ephemeral: true });

  // From the public "streak ended" message: answer privately and remove that message.
  if (from === 'notice') {
    await interaction.reply(msg);
    return interaction.message?.delete().catch(() => {});
  }
  // From /streak (private): replace that message. From /rank (public): answer privately.
  if (interaction.message?.flags?.has?.(64)) {
    msg.flags &= ~64;
    return interaction.update(msg);
  }
  return interaction.reply(msg);
}
