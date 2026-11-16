import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { db } from '../lib/store.js';
import { syncMember } from '../lib/roles.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder().setName('unverify').setDescription('Unlink your Roblox account');

export async function execute(interaction) {
  if (!db.data.links[interaction.user.id]) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.warn).setDescription("You aren't verified.")] });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  delete db.data.links[interaction.user.id];
  db.save();
  await syncMember(interaction.member);
  return interaction.editReply({ embeds: [embed(colors.ok).setDescription('Your Roblox account has been unlinked.')] });
}
