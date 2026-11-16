import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, OverwriteType,
  PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, time,
} from 'discord.js';
import { config } from '../config.js';
import { store } from '../lib/store.js';
import { buildTranscript } from '../lib/transcript.js';
import { colors, embed } from '../lib/ui.js';

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

export const isStaff = (member) =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) || config.supportRoleIds.some((id) => member.roles.cache.has(id));

const ephemeral = (interaction, text, color = colors.bad) => {
  const payload = { flags: MessageFlags.Ephemeral, embeds: [embed(color).setDescription(text)] };
  return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
};

export async function execute(interaction) {
  const ticket = await store.tickets.get(interaction.channelId);
  if (!ticket) return ephemeral(interaction, 'This command only works inside a ticket channel.');
  const sub = interaction.options.getSubcommand();

  if (sub === 'close') {
    if (ticket.ownerId !== interaction.user.id && !isStaff(interaction.member)) {
      return ephemeral(interaction, 'Only the ticket owner or staff can close this ticket.');
    }
    return closeTicket(interaction, interaction.options.getString('reason'));
  }

  if (!isStaff(interaction.member)) return ephemeral(interaction, 'Only staff can do that.');
  const user = interaction.options.getUser('member', true);
  if (sub === 'add') {
    await interaction.channel.permissionOverwrites.edit(user.id, Object.fromEntries(MEMBER_PERMS.map((p) => [permName(p), true])));
    return interaction.reply({ embeds: [embed(colors.ok).setDescription(`Added ${user} to the ticket.`)] });
  }
  if (user.id === ticket.ownerId) return ephemeral(interaction, "You can't remove the ticket owner.");
  await interaction.channel.permissionOverwrites.delete(user.id);
  return interaction.reply({ embeds: [embed(colors.ok).setDescription(`Removed ${user} from the ticket.`)] });
}

export async function handleButton(interaction) {
  const [, action, typeId] = interaction.customId.split(':');
  if (action === 'open') return showForm(interaction, typeId);

  const ticket = await store.tickets.get(interaction.channelId);
  if (!ticket) return ephemeral(interaction, 'This ticket no longer exists.');

  if (action === 'claim') {
    if (!isStaff(interaction.member)) return ephemeral(interaction, 'Only staff can claim tickets.');
    if (!(await store.tickets.claim(interaction.channelId, interaction.user.id))) {
      const current = await store.tickets.get(interaction.channelId);
      return ephemeral(interaction, `Already claimed by <@${current?.claimedBy}>.`);
    }
    await interaction.update({ components: [controls(true)] });
    return interaction.channel.send({ embeds: [embed(colors.ok).setDescription(`${interaction.user} has claimed this ticket and will help you.`)] });
  }

  if (action === 'close') {
    if (ticket.ownerId !== interaction.user.id && !isStaff(interaction.member)) {
      return ephemeral(interaction, 'Only the ticket owner or staff can close this ticket.');
    }
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [embed(colors.warn).setDescription('Close this ticket? The channel will be deleted and a transcript saved.')],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:confirmclose').setLabel('Close ticket').setStyle(ButtonStyle.Danger),
      )],
    });
  }

  if (action === 'confirmclose') return closeTicket(interaction, null);
}

async function showForm(interaction, typeId) {
  const type = config.ticketTypes.find((t) => t.id === typeId);
  if (!type) return ephemeral(interaction, 'This ticket type no longer exists. Ask staff to repost the panel.');
  if (!config.channels.ticketCategory) return ephemeral(interaction, 'Tickets are not set up yet (TICKET_CATEGORY_ID is missing).');

  const existing = await store.tickets.findByOwner(interaction.user.id);
  if (existing) {
    if (interaction.guild.channels.cache.has(existing.channelId)) {
      return ephemeral(interaction, `You already have an open ticket: <#${existing.channelId}>. Please use that one.`, colors.warn);
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
  if (opening.has(interaction.user.id)) return ephemeral(interaction, 'Your ticket is already being created.', colors.warn);

  opening.add(interaction.user.id);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const number = await store.tickets.nextNumber();
    const me = interaction.guild.members.me;

    const channel = await interaction.guild.channels.create({
      name: `${type.id}-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: config.channels.ticketCategory,
      topic: `${type.label} ticket for ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, type: OverwriteType.Member, allow: MEMBER_PERMS },
        ...config.supportRoleIds.map((id) => ({ id, type: OverwriteType.Role, allow: MEMBER_PERMS })),
        { id: me.id, type: OverwriteType.Member, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels] },
      ],
    });

    await store.tickets.create(channel.id, { number, ownerId: interaction.user.id, type: type.id, claimedBy: null, openedAt: Date.now() });

    const questions = type.questions?.length ? type.questions : [{ label: 'How can we help?' }];
    const link = await store.links.get(interaction.user.id);
    const e = embed()
      .setTitle(`${type.emoji ?? ''} ${type.label} — #${number}`.trim())
      .setDescription(`Thanks ${interaction.user}! Staff will be with you soon. Add any screenshots or videos here.`)
      .addFields(
        { name: 'Roblox account', value: link ? `[${link.username}](https://www.roblox.com/users/${link.robloxId}/profile)` : 'Not verified', inline: true },
        { name: 'Opened', value: time(new Date(), 'R'), inline: true },
        ...questions.slice(0, 5).map((q, i) => ({
          name: q.label.slice(0, 256),
          value: (interaction.fields.getTextInputValue(`q${i}`) || '—').slice(0, 1024),
        })),
      );
    const pings = [interaction.user.toString(), ...config.supportRoleIds.map((id) => `<@&${id}>`)].join(' ');
    await channel.send({ content: pings, embeds: [e], components: [controls(false)], allowedMentions: { users: [interaction.user.id], roles: config.supportRoleIds } });

    return interaction.editReply({ embeds: [embed(colors.ok).setDescription(`Your ticket is open: ${channel}`)] });
  } finally {
    opening.delete(interaction.user.id);
  }
}

async function closeTicket(interaction, reason) {
  const channel = interaction.channel;
  const ticket = await store.tickets.startClosing(channel.id); // atomic, so two people pressing Close can't both run this
  if (!ticket) return ephemeral(interaction, 'This ticket is already closing.', colors.warn);

  if (interaction.isButton()) await interaction.update({ embeds: [embed(colors.warn).setDescription('Closing…')], components: [] });
  else await interaction.deferReply();

  const type = config.ticketTypes.find((t) => t.id === ticket.type);
  const header = [
    `Ticket #${ticket.number} (${type?.label ?? ticket.type}) in ${interaction.guild.name}`,
    `Opened by ${ticket.ownerId} at ${new Date(ticket.openedAt).toISOString()}`,
    `Closed by ${interaction.user.tag} at ${new Date().toISOString()}${reason ? ` — ${reason}` : ''}`,
  ].join('\n');

  try {
    const file = await buildTranscript(channel, header);
    const summary = embed(colors.brand)
      .setTitle(`Ticket #${ticket.number} closed`)
      .addFields(
        { name: 'Type', value: type?.label ?? ticket.type, inline: true },
        { name: 'Opened by', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'Closed by', value: `${interaction.user}`, inline: true },
        { name: 'Opened', value: time(new Date(ticket.openedAt), 'f'), inline: true },
        { name: 'Reason', value: reason || '—' },
      );

    const log = config.channels.ticketLog && (await interaction.guild.channels.fetch(config.channels.ticketLog).catch(() => null));
    if (log?.isTextBased()) await log.send({ embeds: [summary], files: [file] });

    const owner = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
    await owner?.send({ embeds: [summary.setDescription(`Your ticket in **${interaction.guild.name}** was closed. A copy of the conversation is attached.`)], files: [file] })
      .catch(() => {}); // DMs closed
  } catch (err) {
    console.error('Transcript failed:', err);
  }

  await channel.send({ embeds: [embed(colors.bad).setDescription('This ticket will be deleted in 5 seconds.')] });
  await store.tickets.delete(channel.id);
  setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(() => {}), 5000);
  if (interaction.deferred && !interaction.isButton()) await interaction.deleteReply().catch(() => {});
}

function controls(claimed) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel(claimed ? 'Claimed' : 'Claim').setEmoji('🙋')
      .setStyle(ButtonStyle.Primary).setDisabled(claimed),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

// permissionOverwrites.edit() wants names like { ViewChannel: true }
const permName = (bit) => Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === bit);
