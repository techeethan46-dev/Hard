import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { notice } from '../lib/ui.js';

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
  const skipped = amount - deleted.size;
  return interaction.editReply(notice('ok', [
    `🧹 Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'}${from ? ` from ${from}` : ''}.`,
    skipped > 0 ? '-# Messages older than 14 days can\'t be bulk-deleted, so some were skipped.' : null,
  ].filter(Boolean).join('\n'), { title: 'Channel cleaned', ephemeral: false }));
}
