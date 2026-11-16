import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config, oauthEnabled } from '../config.js';
import { getSettings } from '../lib/settings.js';
import { getGameIconUrl, getUniverseId } from '../lib/roblox.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

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
  const message = interaction.options.getSubcommand() === 'verify'
    ? await verifyPanel(interaction.guild)
    : ticketPanel(interaction.guild);
  if (!message) return interaction.reply(notice('bad', 'Add ticket types to config.json first.'));

  await channel.send(message);
  return interaction.reply(notice('ok', `Posted in ${channel}. Members can use it right away.`, { title: 'Panel posted' }));
}

export async function verifyPanel(guild) {
  const { placeId, gameName } = await getSettings(guild.id);
  const universeId = placeId && (await getUniverseId(placeId).catch(() => null));
  const icon = (universeId && (await getGameIconUrl(universeId).catch(() => null))) || guild.iconURL({ size: 256 });
  const steps = oauthEnabled()
    ? ['**1** · Press **Verify** below', '**2** · Sign in with Roblox and press **Confirm**', '**3** · Done! Your roles appear instantly']
    : ['**1** · Press **Verify** and type your Roblox username', '**2** · Paste the code you get into your Roblox profile\'s About', '**3** · Press **Done**. Your roles appear instantly'];

  return v2(card(colors.roblox,
    section([
      '## 🔐 Verify your Roblox account',
      `Link your Roblox account to unlock **${guild.name}**${gameName ? ` and show off your **${gameName}** profile` : ''}.`,
    ], thumb(icon)),
    divider(),
    text('**How it works**', ...steps),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:start').setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
    footnote('We never see your password · takes about 30 seconds'),
  ));
}

export function ticketPanel(guild) {
  const types = config.ticketTypes;
  if (!types.length) return null;
  const button = (t, label = 'Open') => {
    const b = new ButtonBuilder().setCustomId(`ticket:open:${t.id}`).setLabel(label)
      .setStyle(ButtonStyle[t.style] ?? ButtonStyle.Secondary);
    return t.emoji ? b.setEmoji(t.emoji) : b;
  };

  // Up to 8 categories get a row each with a description; more than that falls back to a grid of buttons.
  let body;
  if (types.length <= 8) {
    body = types.map((t, i) => [
      section([`**${t.label}**`, t.description ? `-# ${t.description}` : null], button(t)),
      i < types.length - 1 ? divider({ line: false }) : null,
    ]);
  } else {
    body = [];
    for (let i = 0; i < Math.min(types.length, 25); i += 5) {
      body.push(new ActionRowBuilder().addComponents(types.slice(i, i + 5).map((t) => button(t, t.label))));
    }
  }

  return v2(card(colors.ticket,
    section(['## 🎫 Need a hand?', 'Pick what fits best and a **private channel** opens with our staff team.'],
      thumb(guild.iconURL({ size: 256 }))),
    divider(),
    body,
    divider(),
    footnote('One open ticket per person · please don\'t open tickets just to test'),
  ));
}
