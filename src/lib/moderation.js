import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from './ui.js';

/**
 * Checks that the moderator outranks the target and the bot can act on them.
 * Replies with an error and returns false if not.
 */
export async function checkTarget(interaction, target, action) {
  const fail = (msg) => interaction.reply(notice('bad', msg, { title: "Can't do that" })).then(() => false);

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

/** Best-effort DM to the member; members with DMs closed are fine. */
export async function notify(user, guild, { kind = 'warn', title, reason, extra }) {
  const msg = v2(card(colors[kind],
    section([`-# ${guild.name}`, `### ${title}`], thumb(guild.iconURL({ size: 128 }))),
    divider(),
    text(`**Reason**\n> ${reason}`, extra ?? null),
    footnote('If you think this was a mistake, contact the server staff.'),
  ));
  await user.send(msg).catch(() => {});
}
