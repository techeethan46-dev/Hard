import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Suggest something for the game')
  .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(1000));

export async function execute(interaction) {
  const { suggestionsChannel } = await getSettings(interaction.guildId);
  const channel = suggestionsChannel && (await interaction.guild.channels.fetch(suggestionsChannel).catch(() => null));
  if (!channel?.isTextBased()) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.warn).setDescription('Suggestions are not set up yet. An admin can pick a channel with `/setup`.')] });
  }
  const msg = await channel.send({
    embeds: [
      embed()
        .setAuthor({ name: interaction.member.displayName, iconURL: interaction.user.displayAvatarURL() })
        .setTitle('Suggestion')
        .setDescription(interaction.options.getString('idea', true)),
    ],
  });
  await msg.react('👍');
  await msg.react('👎');
  await msg.startThread({ name: `Discuss: ${interaction.member.displayName}'s suggestion`.slice(0, 100) }).catch(() => {});
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.ok).setDescription(`Posted! ${msg.url}`)] });
}
