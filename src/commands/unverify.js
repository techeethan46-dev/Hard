import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { store } from '../lib/store.js';
import { syncMember } from '../lib/roles.js';
import { notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder().setName('unverify').setDescription('Unlink your Roblox account');

export async function execute(interaction) {
  if (!(await store.links.get(interaction.user.id))) {
    return interaction.reply(notice('warn', "You haven't linked a Roblox account. Use `/verify` to link one."));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await store.links.delete(interaction.user.id);
  await syncMember(interaction.member);
  return interaction.editReply(notice('ok', 'Your Roblox account is no longer linked. You can `/verify` again any time.', { title: 'Unlinked', ephemeral: false }));
}
