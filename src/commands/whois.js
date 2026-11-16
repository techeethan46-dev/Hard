import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { getHeadshotUrl, getUser, getUserByUsername, profileUrl } from '../lib/roblox.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Look up a Roblox account')
  .addUserOption((o) => o.setName('member').setDescription('Discord member (must be verified)'))
  .addStringOption((o) => o.setName('username').setDescription('Roblox username').setMaxLength(20));

export async function execute(interaction) {
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
      return interaction.reply(notice('warn', member.id === interaction.user.id
        ? "You haven't linked a Roblox account yet. Use `/verify`."
        : `${member} hasn't linked a Roblox account.`));
    }
  }

  await interaction.deferReply();
  const user = robloxId && (await getUser(robloxId));
  if (!user) return interaction.editReply(notice('bad', `No Roblox user called **${username}**.`, { ephemeral: false }));

  const created = Math.floor(new Date(user.created).getTime() / 1000);
  const ageDays = Math.floor((Date.now() - created * 1000) / 86_400_000);
  const age = ageDays >= 365 ? `${Math.floor(ageDays / 365)} year${ageDays >= 730 ? 's' : ''}` : `${ageDays} day${ageDays === 1 ? '' : 's'}`;
  const bio = (user.description ?? '').replace(/\s+/g, ' ').trim();

  return interaction.editReply(v2(card(user.isBanned ? colors.bad : colors.roblox,
    section([
      `### ${user.displayName}${user.hasVerifiedBadge ? ' ☑️' : ''}`,
      `-# @${user.name} · ID ${user.id}`,
      discordId ? `🔗 Linked to <@${discordId}>` : '🔗 Not linked to Discord',
    ], thumb(await getHeadshotUrl(user.id).catch(() => null))),
    divider(),
    text(
      `🎂 Joined Roblox <t:${created}:D> · ${age} ago`,
      user.isBanned ? '⛔ **This account is banned on Roblox**' : null,
      bio ? `> ${bio.slice(0, 200)}${bio.length > 200 ? '…' : ''}` : null,
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Roblox profile').setEmoji('👤').setStyle(ButtonStyle.Link).setURL(profileUrl(user.id)),
    ),
    footnote('Info from Roblox'),
  )));
}
