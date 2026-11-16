import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { gameUrl, getGame, getGameBannerUrl, getGameIconUrl, getUniverseId } from '../lib/roblox.js';
import { card, colors, divider, footnote, gallery, notice, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder().setName('game').setDescription('Live stats for our Roblox game');

const n = (x) => Number(x ?? 0).toLocaleString('en-US');
const short = (x) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(x ?? 0));

export async function execute(interaction) {
  const { placeId } = await getSettings(interaction.guildId);
  if (!placeId) return interaction.reply(notice('warn', 'No game is set up yet. An admin can add it with `/setup`.'));
  await interaction.deferReply();

  const universeId = await getUniverseId(placeId);
  const game = universeId && (await getGame(universeId));
  if (!game) return interaction.editReply(notice('bad', "Couldn't reach Roblox right now. Try again in a minute.", { ephemeral: false }));

  const [icon, banner] = await Promise.all([
    getGameIconUrl(universeId).catch(() => null),
    getGameBannerUrl(universeId).catch(() => null),
  ]);
  const online = game.playing > 0;
  const updated = Math.floor(new Date(game.updated).getTime() / 1000);
  const about = (game.description ?? '').replace(/\s+/g, ' ').trim();

  return interaction.editReply(v2(card(colors.roblox,
    section([
      `### ${game.name}`,
      `-# by ${game.creator?.name ?? 'Roblox'}${game.creator?.hasVerifiedBadge ? ' ☑️' : ''}`,
      `${online ? '🟢' : '⚫'} **${n(game.playing)}** playing right now`,
    ], thumb(icon)),
    gallery(banner),
    divider(),
    text(
      `👁️ **${short(game.visits)}** visits  ·  ⭐ **${short(game.favoritedCount)}** favorites  ·  👥 **${n(game.maxPlayers)}** per server`,
      `🛠️ Updated <t:${updated}:R>`,
    ),
    about ? text(`> ${about.slice(0, 220)}${about.length > 220 ? '…' : ''}`) : null,
    divider(),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Play now').setEmoji('▶️').setStyle(ButtonStyle.Link).setURL(gameUrl(placeId)),
    ),
    footnote('Live from Roblox · refreshes every 30 seconds'),
  )));
}
