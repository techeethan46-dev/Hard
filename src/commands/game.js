import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, time } from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { gameUrl, getGame, getGameIconUrl, getUniverseId } from '../lib/roblox.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder().setName('game').setDescription('Live stats for our Roblox game');

const n = (x) => Number(x ?? 0).toLocaleString('en-US');

export async function execute(interaction) {
  const { placeId } = await getSettings(interaction.guildId);
  if (!placeId) {
    return interaction.reply({ embeds: [embed(colors.warn).setDescription('No game is set up yet. An admin can add it with `/setup`.')] });
  }
  await interaction.deferReply();
  const universeId = await getUniverseId(placeId);
  const game = universeId && (await getGame(universeId));
  if (!game) return interaction.editReply({ embeds: [embed(colors.bad).setDescription("Couldn't load the game from Roblox.")] });

  const e = embed()
    .setTitle(game.name)
    .setURL(gameUrl(placeId))
    .setThumbnail(await getGameIconUrl(universeId))
    .setDescription((game.description ?? '').slice(0, 300) || null)
    .addFields(
      { name: 'Playing now', value: n(game.playing), inline: true },
      { name: 'Visits', value: n(game.visits), inline: true },
      { name: 'Favorites', value: n(game.favoritedCount), inline: true },
      { name: 'Max players / server', value: n(game.maxPlayers), inline: true },
      { name: 'Last updated', value: time(new Date(game.updated), 'R'), inline: true },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Play').setStyle(ButtonStyle.Link).setURL(gameUrl(placeId)),
  );
  return interaction.editReply({ embeds: [e], components: [row] });
}
