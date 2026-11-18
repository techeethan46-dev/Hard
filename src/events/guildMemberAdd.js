import { Events } from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { screenJoin } from '../lib/raid.js';
import { memberJoined } from '../lib/serverlog.js';
import { syncMember } from '../lib/roles.js';
import { renderBlocks, welcomeVars } from '../lib/compose.js';
import { card, colors, divider, footnote, section, text, thumb, v2 } from '../lib/ui.js';

export const name = Events.GuildMemberAdd;

export async function execute(member) {
  // Raid protection / minimum account age first: kicked people get no welcome.
  if (await screenJoin(member).catch((err) => { console.error('Raid check failed:', err.message); return false; })) return;
  await memberJoined(member).catch((err) => console.error('Join log failed:', err.message));

  // Returning members who verified before get their roles back automatically;
  // new members get the Unverified role (if configured).
  await syncMember(member).catch((err) => console.error('Join sync failed:', err.message));

  const { welcomeChannel, gameName, welcomeMessage } = await getSettings(member.guild.id);
  if (!welcomeChannel) return;
  const channel = await member.guild.channels.fetch(welcomeChannel).catch(() => null);
  if (!channel?.isTextBased()) return;

  // Your own welcome message from /message welcome, if you wrote one.
  if (welcomeMessage?.length) {
    await channel.send(renderBlocks(welcomeMessage, welcomeVars(member, gameName), { mentions: { users: [member.id] } }))
      .catch((err) => console.error('Welcome message failed:', err.message));
    return;
  }

  await channel.send(v2(card(colors.brand,
    section([
      `### 👋 Welcome, ${member.displayName}!`,
      `${member} just joined **${member.guild.name}**${gameName ? `, the home of **${gameName}**` : ''}.`,
    ], thumb(member.user.displayAvatarURL({ size: 256 }))),
    divider(),
    text(
      '**Get started**',
      '🔗 Run `/verify` to link your Roblox account and unlock the server',
      '🎮 Check `/game` to see who\'s playing',
      '🎫 Need help? Open a ticket any time',
    ),
    footnote(`You're member #${member.guild.memberCount.toLocaleString('en-US')}`),
  ), { mentions: { users: [member.id] } }))
    .catch((err) => console.error('Welcome message failed:', err.message));
}
