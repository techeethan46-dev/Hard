import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { todayFor } from '../lib/activity.js';
import { levelInfo } from '../lib/levels.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { RESTORES_PER_MONTH, normalize, restoreQuote, restoresLeft } from '../lib/streaks.js';
import { card, colors, divider, footnote, progress, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Your level, XP and streak')
  .addUserOption((o) => o.setName('member').setDescription('Someone else'));

const n = (x) => Number(x ?? 0).toLocaleString('en-US');

export async function execute(interaction) {
  const user = interaction.options.getUser('member') ?? interaction.user;
  if (user.bot) return interaction.reply(v2(card(colors.warn, text('🤖 Bots don\'t earn XP.')), { ephemeral: true }));

  const settings = await getSettings(interaction.guildId);
  const doc = (await store.stats.get(interaction.guildId, user.id)) ?? { xp: 0 };
  const info = levelInfo(doc.xp);
  const position = doc.xp > 0 ? await store.stats.position(interaction.guildId, 'xp', doc.xp) : null;
  const today = todayFor(settings);
  const streak = normalize(doc.streak);
  const self = user.id === interaction.user.id;
  const q = restoreQuote(streak, today);
  const nextReward = (settings.levelRewards ?? []).filter((r) => r.level > info.level).sort((a, b) => a.level - b.level)[0];

  return interaction.reply(v2(card(colors.brand,
    section([
      `### ${user.displayName ?? user.username}`,
      `**Level ${info.level}**${position ? ` · #${position} in the server` : ''}`,
      `${progress(Math.round((info.into / info.needed) * 14), 14)}`,
      `-# ${n(info.into)} / ${n(info.needed)} XP · ${n(doc.xp)} total`,
    ], thumb(user.displayAvatarURL({ size: 256 }))),
    divider(),
    text(
      `🔥 **${streak.current}** day streak${streak.best > streak.current ? ` · best ${streak.best}` : streak.current ? ' · personal best!' : ''}`,
      `🛟 **${restoresLeft(streak, today)}/${RESTORES_PER_MONTH}** restores left this month`,
      nextReward ? `🎁 Level ${nextReward.level} unlocks <@&${nextReward.roleId}>` : null,
    ),
    self && q.possible
      ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`streak:restore:${user.id}`).setEmoji('🔥')
          .setLabel(`Restore ${streak.lost}🔥 streak (${q.cost} restore${q.cost === 1 ? '' : 's'})`).setStyle(ButtonStyle.Success),
      )
      : null,
    footnote('Chat to earn XP · chat every day to grow your 🔥'),
  )));
}
