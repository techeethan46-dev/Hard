import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, OverwriteType,
  PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, time,
} from 'discord.js';
import { config } from '../config.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { buildTranscript } from '../lib/transcript.js';
import { card, colors, divider, embed, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

// Flow: member clicks a category on the /panel tickets message -> fills in a short form ->
// a private channel is created for them + support staff -> staff claim it -> anyone closes it ->
// a transcript goes to the log channel and to the member's DMs, and the channel is deleted.

const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
];
const opening = new Set(); // members whose ticket is being created right now (double-click guard)

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Manage the ticket you are in')
  .addSubcommand((s) => s.setName('close').setDescription('Close this ticket')
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
  .addSubcommand((s) => s.setName('add').setDescription('(Staff) Add someone to this ticket')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('(Staff) Remove someone from this ticket')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)));

export async function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const { supportRoles = [] } = await getSettings(member.guild.id);
  return supportRoles.some((id) => member.roles.cache.has(id));
}

const ephemeral = (interaction, message, kind = 'bad') => {
  const payload = notice(kind, message);
  return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
};

/** The main card inside a ticket channel. Re-rendered when someone claims it. */
function ticketCard(ticket, type, ownerAvatar) {
  const claimed = Boolean(ticket.claimedBy);
  return card(colors.ticket,
    section([
      `### ${type?.emoji ?? '🎫'} ${type?.label ?? 'Ticket'} · #${String(ticket.number).padStart(4, '0')}`,
      `-# Opened by <@${ticket.ownerId}> · <t:${Math.floor(ticket.openedAt / 1000)}:R>`,
      ticket.roblox
        ? `🎮 [${ticket.roblox.username}](https://www.roblox.com/users/${ticket.roblox.robloxId}/profile)`
        : '🎮 Roblox account not linked',
    ], thumb(ownerAvatar)),
    divider(),
    text((ticket.answers ?? []).map(({ q, a }) => `**${q}**\n${a ? a.split('\n').map((l) => `> ${l}`).join('\n') : '-# No answer'}`).join('\n\n')),
    divider(),
    text(claimed
      ? `🙋 <@${ticket.claimedBy}> is helping you.`
      : '⏳ Thanks! A staff member will be with you soon. Add any screenshots or videos below.'),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel(claimed ? 'Claimed' : 'Claim').setEmoji('🙋')
        .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(claimed),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    ),
    footnote('Only you and the staff team can see this channel.'),
  );
}

export async function execute(interaction) {
  const ticket = await store.tickets.get(interaction.channelId);
  if (!ticket) return ephemeral(interaction, 'This command only works inside a ticket channel.');
  const sub = interaction.options.getSubcommand();

  if (sub === 'close') {
    if (ticket.ownerId !== interaction.user.id && !(await isStaff(interaction.member))) {
      return ephemeral(interaction, 'Only the ticket owner or staff can close this ticket.');
    }
    return closeTicket(interaction, interaction.options.getString('reason'));
  }

  if (!(await isStaff(interaction.member))) return ephemeral(interaction, 'Only staff can do that.');
  const user = interaction.options.getUser('member', true);
  if (sub === 'add') {
    await interaction.channel.permissionOverwrites.edit(user.id, Object.fromEntries(MEMBER_PERMS.map((p) => [permName(p), true])));
    return interaction.reply(notice('ok', `${user} can now see this ticket.`, { ephemeral: false }));
  }
  if (user.id === ticket.ownerId) return ephemeral(interaction, "You can't remove the ticket owner.");
  await interaction.channel.permissionOverwrites.delete(user.id);
  return interaction.reply(notice('ok', `${user} was removed from this ticket.`, { ephemeral: false }));
}

export async function handleButton(interaction) {
  const [, action, typeId] = interaction.customId.split(':');
  if (action === 'open') return showForm(interaction, typeId);

  const ticket = await store.tickets.get(interaction.channelId);
  if (!ticket) return ephemeral(interaction, 'This ticket no longer exists.');

  if (action === 'claim') {
    if (!(await isStaff(interaction.member))) return ephemeral(interaction, 'Only staff can claim tickets.');
    if (!(await store.tickets.claim(interaction.channelId, interaction.user.id))) {
      const current = await store.tickets.get(interaction.channelId);
      return ephemeral(interaction, `Already claimed by <@${current?.claimedBy}>.`);
    }
    const type = config.ticketTypes.find((t) => t.id === ticket.type);
    const owner = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
    return interaction.update(v2(ticketCard({ ...ticket, claimedBy: interaction.user.id }, type, owner?.displayAvatarURL({ size: 128 }))));
  }

  if (action === 'close') {
    if (ticket.ownerId !== interaction.user.id && !(await isStaff(interaction.member))) {
      return ephemeral(interaction, 'Only the ticket owner or staff can close this ticket.');
    }
    return interaction.reply(v2(card(colors.warn,
      text('### 🔒 Close this ticket?', 'The channel will be deleted. A transcript is saved for staff and sent to the member.'),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:confirmclose').setLabel('Yes, close it').setStyle(ButtonStyle.Danger),
      ),
      footnote('Changed your mind? Just dismiss this message.'),
    ), { ephemeral: true }));
  }

  if (action === 'confirmclose') return closeTicket(interaction, null);
}

async function showForm(interaction, typeId) {
  const type = config.ticketTypes.find((t) => t.id === typeId);
  if (!type) return ephemeral(interaction, 'This ticket type no longer exists. Ask staff to repost the panel.');
  const { ticketCategory } = await getSettings(interaction.guildId);
  if (!ticketCategory) return ephemeral(interaction, 'Tickets are not set up yet. An admin can pick a ticket category with `/setup`.');

  const existing = await store.tickets.findByOwner(interaction.guildId, interaction.user.id);
  if (existing) {
    if (interaction.guild.channels.cache.has(existing.channelId)) {
      return ephemeral(interaction, `You already have an open ticket: <#${existing.channelId}>. Please use that one.`, 'warn');
    }
    await store.tickets.delete(existing.channelId); // channel was deleted by hand; forget it
  }

  const questions = (type.questions?.length ? type.questions : [{ label: 'How can we help?', style: 'paragraph', required: true }]).slice(0, 5);
  const modal = new ModalBuilder().setCustomId(`ticket:form:${type.id}`).setTitle(type.label.slice(0, 45)).addComponents(
    questions.map((q, i) => new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`q${i}`).setLabel(q.label.slice(0, 45))
        .setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(q.required !== false).setMaxLength(q.style === 'short' ? 100 : 1500),
    )),
  );
  return interaction.showModal(modal);
}

export async function handleModal(interaction) {
  const typeId = interaction.customId.split(':')[2];
  const type = config.ticketTypes.find((t) => t.id === typeId);
  if (!type) return ephemeral(interaction, 'Unknown ticket type.');
  if (opening.has(interaction.user.id)) return ephemeral(interaction, 'Your ticket is already being created.', 'warn');

  opening.add(interaction.user.id);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { ticketCategory, supportRoles = [] } = await getSettings(interaction.guildId);
    const number = await store.tickets.nextNumber(interaction.guildId);
    const me = interaction.guild.members.me;

    const channel = await interaction.guild.channels.create({
      name: `${type.id}-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: ticketCategory,
      topic: `${type.label} ticket for ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, type: OverwriteType.Member, allow: MEMBER_PERMS },
        ...supportRoles.map((id) => ({ id, type: OverwriteType.Role, allow: MEMBER_PERMS })),
        { id: me.id, type: OverwriteType.Member, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels] },
      ],
    });

    const questions = type.questions?.length ? type.questions : [{ label: 'How can we help?' }];
    const link = await store.links.get(interaction.user.id);
    const ticket = {
      guildId: interaction.guildId, number, ownerId: interaction.user.id, type: type.id, claimedBy: null, openedAt: Date.now(),
      roblox: link ? { username: link.username, robloxId: link.robloxId } : null,
      answers: questions.slice(0, 5).map((q, i) => ({ q: q.label, a: interaction.fields.getTextInputValue(`q${i}`).slice(0, 1000) })),
    };
    await store.tickets.create(channel.id, ticket);

    const pings = [interaction.user.toString(), ...supportRoles.map((id) => `<@&${id}>`)].join(' ');
    await channel.send(v2([text(pings), ticketCard(ticket, type, interaction.user.displayAvatarURL({ size: 128 }))],
      { mentions: { users: [interaction.user.id], roles: supportRoles } }));

    return interaction.editReply(notice('ok', `Head over to ${channel}. Staff have been notified.`, { title: 'Ticket opened', ephemeral: false }));
  } finally {
    opening.delete(interaction.user.id);
  }
}

async function closeTicket(interaction, reason) {
  const channel = interaction.channel;
  const ticket = await store.tickets.startClosing(channel.id); // atomic, so two people pressing Close can't both run this
  if (!ticket) return ephemeral(interaction, 'This ticket is already closing.', 'warn');

  if (interaction.isButton()) await interaction.update(notice('warn', 'Closing the ticket…', { ephemeral: false }));
  else await interaction.deferReply();

  const type = config.ticketTypes.find((t) => t.id === ticket.type);
  const header = [
    `Ticket #${ticket.number} (${type?.label ?? ticket.type}) in ${interaction.guild.name}`,
    `Opened by ${ticket.ownerId} at ${new Date(ticket.openedAt).toISOString()}`,
    `Closed by ${interaction.user.tag} at ${new Date().toISOString()}${reason ? ` — ${reason}` : ''}`,
  ].join('\n');

  try {
    const file = await buildTranscript(channel, header);
    const summary = embed(colors.ticket)
      .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL() ?? undefined })
      .setTitle(`${type?.emoji ?? '🎫'} Ticket #${String(ticket.number).padStart(4, '0')} closed`)
      .addFields(
        { name: 'Type', value: type?.label ?? ticket.type, inline: true },
        { name: 'Opened by', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'Closed by', value: `${interaction.user}`, inline: true },
        { name: 'Opened', value: time(new Date(ticket.openedAt), 'f'), inline: true },
        { name: 'Reason', value: reason || '—' },
      )
      .setFooter({ text: 'Full conversation attached' });

    const { ticketLogChannel } = await getSettings(interaction.guildId);
    const log = ticketLogChannel && (await interaction.guild.channels.fetch(ticketLogChannel).catch(() => null));
    if (log?.isTextBased()) await log.send({ embeds: [summary], files: [file] });

    const owner = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
    await owner?.send({ embeds: [summary.setDescription(`Your ticket in **${interaction.guild.name}** was closed. A copy of the conversation is attached.`)], files: [file] })
      .catch(() => {}); // DMs closed
  } catch (err) {
    console.error('Transcript failed:', err);
  }

  await channel.send(v2(card(colors.bad,
    text(`### 🔒 Ticket closed`, `Closed by ${interaction.user}${reason ? ` · ${reason}` : ''}`),
    footnote('This channel will be deleted in 5 seconds. A transcript has been saved.'),
  )));
  await store.tickets.delete(channel.id);
  setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(() => {}), 5000);
  if (interaction.deferred && !interaction.isButton()) await interaction.deleteReply().catch(() => {});
}


// permissionOverwrites.edit() wants names like { ViewChannel: true }
const permName = (bit) => Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === bit);
