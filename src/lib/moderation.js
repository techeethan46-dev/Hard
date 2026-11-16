import { MessageFlags } from 'discord.js';
import { colors, embed } from './ui.js';

/**
 * Checks that the moderator outranks the target and the bot can act on them.
 * Replies with an error and returns false if not.
 */
export async function checkTarget(interaction, target, action) {
  const fail = (msg) =>
    interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.bad).setDescription(msg)] }).then(() => false);

  if (!target) return fail('That user is not in this server.');
  if (target.id === interaction.user.id) return fail(`You can't ${action} yourself.`);
  if (target.id === interaction.guild.ownerId) return fail(`You can't ${action} the server owner.`);
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  if (!isOwner && target.roles.highest.position >= interaction.member.roles.highest.position) {
    return fail(`You can't ${action} someone with an equal or higher role.`);
  }
  const botCan = { kick: target.kickable, ban: target.bannable, timeout: target.moderatable, warn: true }[action];
  if (!botCan) return fail(`I can't ${action} that member — move my role above theirs.`);
  return true;
}

/** Best-effort DM; members with DMs closed are fine. */
export async function notify(user, guild, text) {
  await user.send({ embeds: [embed(colors.warn).setTitle(guild.name).setDescription(text)] }).catch(() => {});
}
