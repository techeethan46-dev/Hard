import {
  ActionRowBuilder, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { removeSticky, setSticky } from '../lib/sticky.js';
import { card, colors, footnote, notice, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('sticky')
  .setDescription('Keep a message stuck at the bottom of a channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((s) => s.setName('set').setDescription('Set (or change) the sticky message in this channel'))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove the sticky message from this channel'))
  .addSubcommand((s) => s.setName('list').setDescription('See every channel with a sticky message'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { stickies = {} } = await getSettings(interaction.guildId);

  if (sub === 'set') {
    const current = stickies[interaction.channelId];
    return interaction.showModal(new ModalBuilder().setCustomId('sticky:save').setTitle('Sticky message').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title (optional)')
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setValue(current?.title ?? '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Message')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(current?.text ?? '')
        .setPlaceholder('e.g. Read #rules before posting! Trading only in #trading.')),
    ));
  }

  if (sub === 'remove') {
    const removed = await removeSticky(interaction.guild, interaction.channelId);
    return interaction.reply(removed ? notice('ok', 'This channel no longer has a sticky message.', { title: 'Sticky removed' })
      : notice('warn', 'This channel doesn\'t have a sticky message.'));
  }

  const list = Object.entries(stickies);
  return interaction.reply(v2(card(colors.info,
    text('### 📌 Sticky messages', list.length
      ? list.map(([ch, s]) => `<#${ch}> · ${s.title ? `**${s.title}**` : s.text.replace(/\s+/g, ' ').slice(0, 60)}`)
      : ['None yet. Run `/sticky set` in a channel to add one.']),
    footnote('Remove one with /sticky remove in that channel'),
  ), { ephemeral: true }));
}

export async function handleModal(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return interaction.reply(notice('bad', 'You need **Manage Messages**.'));
  await interaction.deferReply({ flags: 64 });
  try {
    await setSticky(interaction.channel, {
      title: interaction.fields.getTextInputValue('title').trim(),
      text: interaction.fields.getTextInputValue('text').trim(),
    });
  } catch {
    return interaction.editReply(notice('bad', 'I can\'t post in this channel. Give me **Send Messages** and **Manage Messages** here.', { ephemeral: false }));
  }
  return interaction.editReply(notice('ok', 'It\'ll stay at the bottom of this channel. I repost it a few seconds after people stop chatting.', { title: 'Sticky set', ephemeral: false }));
}
