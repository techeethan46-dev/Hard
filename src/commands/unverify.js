import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { store } from '../lib/store.js';
import { syncMember } from '../lib/roles.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder().setName('unverify').setDescription('Unlink your Roblox account');

export async function execute(interaction) {
  if (!(await store.links.get(interaction.user.id))) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.warn).setDescription("You aren't verified.")] });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await store.links.delete(interaction.user.id);
  await syncMember(interaction.member);
  return interaction.editReply({ embeds: [embed(colors.ok).setDescription('Your Roblox account has been unlinked.')] });
}
