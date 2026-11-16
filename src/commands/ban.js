import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkTarget, notify } from '../lib/moderation.js';
import { colors, embed, modLog } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban or unban a user')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addSubcommand((s) =>
    s.setName('add').setDescription('Ban a user')
      .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
      .addIntegerOption((o) =>
        o.setName('delete_messages').setDescription('Delete their recent messages')
          .addChoices({ name: "Don't delete", value: 0 }, { name: 'Last hour', value: 3600 },
            { name: 'Last 24 hours', value: 86400 }, { name: 'Last 7 days', value: 604800 })))
  .addSubcommand((s) =>
    s.setName('remove').setDescription('Unban a user')
      .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)));

export async function execute(interaction) {
  const reason = interaction.options.getString('reason') ?? 'No reason given';

  if (interaction.options.getSubcommand() === 'remove') {
    const id = interaction.options.getString('user_id', true);
    const user = await interaction.guild.bans.remove(id, `${interaction.user.tag}: ${reason}`).catch(() => null);
    if (!user) return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.bad).setDescription("That user isn't banned.")] });
    await modLog(interaction.guild, { action: 'Unban', target: user, moderator: interaction.user, reason, color: colors.ok });
    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.ok).setDescription(`Unbanned ${user.tag}.`)] });
  }

  const user = interaction.options.getUser('user', true);
  const member = interaction.options.getMember('user');
  // Users who already left can still be banned; only check hierarchy for current members.
  if (member && !(await checkTarget(interaction, member, 'ban'))) return;
  if (member) await notify(user, interaction.guild, `You were banned: **${reason}**`);
  await interaction.guild.bans.create(user.id, {
    reason: `${interaction.user.tag}: ${reason}`,
    deleteMessageSeconds: interaction.options.getInteger('delete_messages') ?? 0,
  });
  await modLog(interaction.guild, { action: 'Ban', target: user, moderator: interaction.user, reason, color: colors.bad });
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.ok).setDescription(`Banned ${user.tag}.`)] });
}
