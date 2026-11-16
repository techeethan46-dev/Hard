import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { colors, embed } from '../lib/ui.js';

// Posts the permanent button panels members click: one for verifying, one for opening tickets.
export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Post a button panel (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s.setName('verify').setDescription('Post the "Verify" button')
      .addChannelOption((o) => o.setName('channel').setDescription('Defaults to this channel').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) =>
    s.setName('tickets').setDescription('Post the "Open a ticket" buttons')
      .addChannelOption((o) => o.setName('channel').setDescription('Defaults to this channel').addChannelTypes(ChannelType.GuildText)));

export async function execute(interaction) {
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  let message;

  if (interaction.options.getSubcommand() === 'verify') {
    message = {
      embeds: [embed().setTitle('Verify your Roblox account')
        .setDescription('Click **Verify** to link your Roblox account and unlock the rest of the server.')],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify:start').setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success),
      )],
    };
  } else {
    if (!config.ticketTypes.length) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.bad).setDescription('Add ticket types to config.json first.')] });
    }
    const buttons = config.ticketTypes.slice(0, 25).map((t) => {
      const b = new ButtonBuilder().setCustomId(`ticket:open:${t.id}`).setLabel(t.label)
        .setStyle(ButtonStyle[t.style] ?? ButtonStyle.Secondary);
      return t.emoji ? b.setEmoji(t.emoji) : b;
    });
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    message = {
      embeds: [embed().setTitle('Need help?')
        .setDescription('Pick a category below to open a private ticket with our staff team.\n\n' +
          config.ticketTypes.map((t) => `${t.emoji ?? '•'} **${t.label}**`).join('\n'))],
      components: rows,
    };
  }

  await channel.send(message);
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed(colors.ok).setDescription(`Panel posted in ${channel}.`)] });
}
