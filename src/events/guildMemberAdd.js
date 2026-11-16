import { Events } from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { syncMember } from '../lib/roles.js';
import { embed } from '../lib/ui.js';

export const name = Events.GuildMemberAdd;

export async function execute(member) {
  // Returning members who verified before get their roles back automatically;
  // new members get the Unverified role (if configured).
  await syncMember(member).catch((err) => console.error('Join sync failed:', err.message));

  const { welcomeChannel } = await getSettings(member.guild.id);
  if (!welcomeChannel) return;
  const channel = await member.guild.channels.fetch(welcomeChannel).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({
    content: `${member}`,
    embeds: [
      embed()
        .setTitle(`Welcome to ${member.guild.name}!`)
        .setDescription('Run `/verify` to link your Roblox account and unlock the rest of the server.')
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: `Member #${member.guild.memberCount}` }),
    ],
  }).catch((err) => console.error('Welcome message failed:', err.message));
}
