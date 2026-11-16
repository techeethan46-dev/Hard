import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk-delete recent messages in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((o) => o.setName('amount').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
  .addUserOption((o) => o.setName('from').setDescription('Only delete messages from this user'));

export async function execute(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  const from = interaction.options.getUser('from');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let messages = await interaction.channel.messages.fetch({ limit: 100 });
  if (from) messages = messages.filter((m) => m.author.id === from.id);
  // Discord can't bulk-delete messages older than 14 days; `true` skips them.
  const deleted = await interaction.channel.bulkDelete([...messages.values()].slice(0, amount), true);
  return interaction.editReply({ embeds: [embed(colors.ok).setDescription(`Deleted ${deleted.size} message(s).`)] });
}
