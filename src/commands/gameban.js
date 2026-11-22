import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getHeadshotUrl, getUniverseId, getUser, getUserByUsername, profileUrl } from '../lib/roblox.js';
import { banEnabled, banPlayer, getBan, unbanPlayer } from '../lib/robloxban.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, modLog, notice, section, text, thumb, v2 } from '../lib/ui.js';

// Owner-only: ban players from the Roblox GAME (not the Discord server). Only the Discord IDs in config.json "ownerIds" can use it.

const target = (s) => s
  .addStringOption((o) => o.setName('roblox').setDescription('Roblox username or user ID').setMaxLength(40))
  .addUserOption((o) => o.setName('member').setDescription('Or a Discord member (uses their linked Roblox account)'));

export const data = new SlashCommandBuilder()
  .setName('gameban')
  .setDescription('(Owners) Ban a player from the Roblox game')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => target(s.setName('ban').setDescription('Ban a player from the game'))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(300))
    .addIntegerOption((o) => o.setName('days').setDescription('How many days (leave empty for permanent)').setMinValue(1).setMaxValue(3650)))
  .addSubcommand((s) => target(s.setName('unban').setDescription('Lift a game ban')))
  .addSubcommand((s) => target(s.setName('check').setDescription('See if a player is banned from the game')));

export const isOwner = (userId) => config.ownerIds.includes(userId);

/** Who the command is about: { robloxId, name } or { error }. */
async function resolve(interaction) {
  const typed = interaction.options.getString('roblox')?.trim();
  const member = interaction.options.getUser('member');
  if (!typed === !member) return { error: 'Give either a **Roblox username or ID**, or a **member**, not both and not neither.' };

  if (member) {
    const link = await store.links.get(member.id);
    return link ? { robloxId: link.robloxId, name: link.username } : { error: `${member} hasn't linked a Roblox account, so I don't know who they are in the game. Type their Roblox username instead.` };
  }
  const user = /^\d{1,15}$/.test(typed) ? await getUser(typed) : await getUserByUsername(typed);
  if (!user) return { error: `There's no Roblox account called **${typed}**.` };
  return { robloxId: user.id, name: user.name };
}

const when = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

export async function execute(interaction) {
  if (!config.ownerIds.length) return interaction.reply(notice('bad', 'No owners are set yet. Add Discord user IDs to `ownerIds` in config.json.', { title: 'Not set up' }));
  if (!isOwner(interaction.user.id)) return interaction.reply(notice('bad', 'Only the game owners can use this command.', { title: 'Owners only' }));
  if (!banEnabled()) return interaction.reply(notice('bad', 'The Roblox API key isn\'t set. Add `ROBLOX_API_KEY` in Render.', { title: 'Not set up' }));

  const { placeId } = await getSettings(interaction.guildId);
  const universeId = placeId && (await getUniverseId(placeId).catch(() => null));
  if (!universeId) return interaction.reply(notice('bad', 'Set the Roblox game in `/setup` first.', { title: 'No game set' }));

  await interaction.deferReply({ ephemeral: true });
  const who = await resolve(interaction);
  if (who.error) return interaction.editReply(notice('bad', who.error, { title: 'Who?', ephemeral: false }));

  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'check') return await check(interaction, universeId, who);
    if (sub === 'unban') return await unban(interaction, universeId, who);
    return await ban(interaction, universeId, who);
  } catch (err) {
    console.error('gameban failed:', err);
    return interaction.editReply(notice('bad', err.message, { title: 'It didn\'t work', ephemeral: false }));
  }
}

const logTarget = async (who) => ({
  id: who.robloxId, username: who.name, tag: `Roblox · ${who.robloxId}`,
  displayAvatarURL: () => null, _headshot: await getHeadshotUrl(who.robloxId).catch(() => null),
});

async function ban(interaction, universeId, who) {
  const reason = interaction.options.getString('reason', true);
  const days = interaction.options.getInteger('days');
  const now = await banPlayer(universeId, who.robloxId, { days, reason });
  const headshot = await getHeadshotUrl(who.robloxId).catch(() => null);

  await modLog(interaction.guild, {
    action: 'Game Ban', moderator: interaction.user, reason, color: colors.bad,
    target: { ...(await logTarget(who)), displayAvatarURL: () => headshot },
    extra: { name: 'Length', value: days ? `${days} day${days === 1 ? '' : 's'}` : 'Permanent' },
  });
  return interaction.editReply(v2(card(colors.bad,
    section([`### 🔨 Banned from the game`, `[${who.name}](${profileUrl(who.robloxId)}) · ID ${who.robloxId}`,
      `**Length:** ${days ? `${days} day${days === 1 ? '' : 's'} (ends ${when(now.expiresAt ?? Date.now() + days * 86_400_000)})` : 'Permanent'}`, `**Reason:** ${reason}`], thumb(headshot)),
    divider(),
    footnote('Lift it with /gameban unban · it only affects the Roblox game'),
  )));
}

async function unban(interaction, universeId, who) {
  if (!(await unbanPlayer(universeId, who.robloxId))) {
    return interaction.editReply(notice('warn', `**${who.name}** isn't banned from the game.`, { title: 'Nothing to lift', ephemeral: false }));
  }
  const headshot = await getHeadshotUrl(who.robloxId).catch(() => null);
  await modLog(interaction.guild, {
    action: 'Game Unban', moderator: interaction.user, reason: 'Ban lifted', color: colors.ok,
    target: { ...(await logTarget(who)), displayAvatarURL: () => headshot },
  });
  return interaction.editReply(notice('ok', `**${who.name}** can play again.`, { title: 'Ban lifted', ephemeral: false }));
}

async function check(interaction, universeId, who) {
  const ban = await getBan(universeId, who.robloxId);
  return interaction.editReply(ban?.active
    ? notice('bad', `**${who.name}** is banned from the game.\n**Reason:** ${ban.reason || 'none'}\n**Ends:** ${ban.expiresAt ? when(ban.expiresAt) : 'never (permanent)'}`, { title: 'Banned', ephemeral: false })
    : notice('ok', `**${who.name}** is not banned from the game.`, { title: 'Not banned', ephemeral: false }));
}
