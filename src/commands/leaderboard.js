import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { levelInfo } from '../lib/levels.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top members by level or streak')
  .addStringOption((o) => o.setName('by').setDescription('What to rank by')
    .addChoices({ name: '⭐ Level', value: 'xp' }, { name: '🔥 Streak', value: 'streak' }));

const MEDALS = ['🥇', '🥈', '🥉'];
const n = (x) => Number(x ?? 0).toLocaleString('en-US');

export async function execute(interaction) {
  return interaction.reply(await board(interaction, interaction.options.getString('by') ?? 'xp'));
}

export async function handleButton(interaction) {
  return interaction.update(await board(interaction, interaction.customId.split(':')[1]));
}

async function board(interaction, by) {
  const field = by === 'streak' ? 'streak.current' : 'xp';
  const top = await store.stats.top(interaction.guildId, field, 10);
  const lines = top.map((d, i) => {
    const place = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``;
    const stat = by === 'streak'
      ? `**${d.streak.current}🔥** day${d.streak.current === 1 ? '' : 's'}`
      : `**Level ${levelInfo(d.xp).level}** · ${n(d.xp)} XP`;
    return `${place} <@${d.userId}> · ${stat}`;
  });

  const me = (await store.stats.get(interaction.guildId, interaction.user.id)) ?? {};
  const myValue = by === 'streak' ? (me.streak?.current ?? 0) : (me.xp ?? 0);
  const myPlace = myValue > 0 ? await store.stats.position(interaction.guildId, field, myValue) : null;

  return v2(card(by === 'streak' ? colors.warn : colors.brand,
    section([
      `### ${by === 'streak' ? '🔥 Streak leaderboard' : '⭐ Level leaderboard'}`,
      `-# ${interaction.guild.name}`,
    ], thumb(interaction.guild.iconURL({ size: 128 }))),
    divider(),
    text(lines.length ? lines : ['Nobody yet. Start chatting to be first! 💬']),
    divider(),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('leaderboard:xp').setLabel('Levels').setEmoji('⭐')
        .setStyle(by === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(by === 'xp'),
      new ButtonBuilder().setCustomId('leaderboard:streak').setLabel('Streaks').setEmoji('🔥')
        .setStyle(by === 'streak' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(by === 'streak'),
    ),
    footnote(myPlace ? `You're #${myPlace} · ${by === 'streak' ? `${myValue}🔥` : `level ${levelInfo(myValue).level}`}` : 'You\'re not on the board yet'),
  ));
}
