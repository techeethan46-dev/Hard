import { SlashCommandBuilder, time } from 'discord.js';
import { getHeadshotUrl, getUser, getUserByUsername, profileUrl } from '../lib/roblox.js';
import { store } from '../lib/store.js';
import { colors, embed } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Look up a Roblox account')
  .addUserOption((o) => o.setName('member').setDescription('Discord member (must be verified)'))
  .addStringOption((o) => o.setName('username').setDescription('Roblox username').setMaxLength(20));

export async function execute(interaction) {
  await interaction.deferReply();
  const username = interaction.options.getString('username');
  let robloxId;
  let discordId;

  if (username) {
    robloxId = (await getUserByUsername(username))?.id;
    discordId = robloxId && (await store.links.findDiscordId(robloxId));
  } else {
    const member = interaction.options.getUser('member') ?? interaction.user;
    discordId = member.id;
    robloxId = (await store.links.get(member.id))?.robloxId;
    if (!robloxId) {
      return interaction.editReply({ embeds: [embed(colors.warn).setDescription(`${member} hasn't verified a Roblox account.`)] });
    }
  }

  const user = robloxId && (await getUser(robloxId));
  if (!user) return interaction.editReply({ embeds: [embed(colors.bad).setDescription('Roblox user not found.')] });

  const e = embed()
    .setTitle(`${user.displayName} (@${user.name})`)
    .setURL(profileUrl(user.id))
    .setThumbnail(await getHeadshotUrl(user.id))
    .addFields(
      { name: 'User ID', value: String(user.id), inline: true },
      { name: 'Joined Roblox', value: time(new Date(user.created), 'D'), inline: true },
      { name: 'Discord', value: discordId ? `<@${discordId}>` : 'Not linked', inline: true },
    );
  if (user.isBanned) e.setColor(colors.bad).setFooter({ text: 'This account is banned on Roblox' });
  return interaction.editReply({ embeds: [e] });
}
