import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkTarget, notify } from '../lib/moderation.js';
import { modLog, notice } from '../lib/ui.js';

const DURATIONS = [
  ['Remove timeout', 0], ['60 seconds', 60], ['5 minutes', 300], ['10 minutes', 600],
  ['1 hour', 3600], ['1 day', 86400], ['1 week', 604800], ['28 days', 2419200],
];

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Time out (mute) a member')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
  .addIntegerOption((o) =>
    o.setName('duration').setDescription('How long').setRequired(true)
      .addChoices(...DURATIONS.map(([name, value]) => ({ name, value }))))
  .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500));

export async function execute(interaction) {
  const target = interaction.options.getMember('member');
  const seconds = interaction.options.getInteger('duration', true);
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  if (!(await checkTarget(interaction, target, 'timeout'))) return;

  const label = DURATIONS.find(([, v]) => v === seconds)?.[0] ?? `${seconds}s`;
  await target.timeout(seconds ? seconds * 1000 : null, `${interaction.user.tag}: ${reason}`);
  if (seconds) await notify(target.user, interaction.guild, { kind: 'warn', title: `You were timed out for ${label}`, reason });
  await modLog(interaction.guild, {
    action: seconds ? `Timeout (${label})` : 'Timeout removed', target: target.user, moderator: interaction.user, reason,
  });
  return interaction.reply(seconds
    ? notice('ok', `${target} can't chat for **${label}**.\n-# Ends <t:${Math.floor((Date.now() + seconds * 1000) / 1000)}:R>`, { title: 'Timed out' })
    : notice('ok', `${target} can chat again.`, { title: 'Timeout removed' }));
}
