import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits,
  SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import {
  MAX_BLOCKS, MAX_COMPONENTS, MAX_TEXT, componentCount, defaultWelcome, parseButtons, parseColor, parseImage, problem,
  renderBlocks, textLength, welcomeVars,
} from '../lib/compose.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

// /message: write rich messages (rules, announcements) from a banner and cards, post them, and edit them later.
// A builder (private to you) keeps the draft in memory while you work. customIds:
//   message:b:<action>      builder buttons/select      message:m:<card|banner>:<index|new>   modals

export const data = new SlashCommandBuilder()
  .setName('message')
  .setDescription('Write rich messages like rules and announcements, and edit them later')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('create').setDescription('Build a new message and post it')
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('edit').setDescription('Change a message that was made with /message')
    .addStringOption((o) => o.setName('message').setDescription('Pick it from the list (or paste its link)').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('welcome').setDescription('Write your own welcome message for new members'));

const drafts = new Map(); // userId -> { mode: 'post' | 'edit' | 'welcome', guildId, channelId, messageId, blocks, selected }
const SAMPLE_COLORS = '#5865F2, blue, gold, red';

const ephemeral = (payload) => ({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
const canUse = (i) => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
const gone = (i) => i.reply(notice('warn', 'That builder has expired (the bot restarted, or you started another one). Run `/message create` again.'));

/** "Title" of a block for lists: the first line of its text without the markdown. */
const label = (b) => (b.type === 'banner' ? 'Banner image' : (b.text.split('\n').find((l) => l.trim()) ?? 'Card').replace(/^[#>\-\s*_`]+/, '').replace(/[*_`]/g, '').trim().slice(0, 45) || 'Card');

// ---------------------------------------------------------------- commands

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const base = { guildId: interaction.guildId, blocks: [], selected: null };

  if (sub === 'create') {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    drafts.set(interaction.user.id, { ...base, mode: 'post', channelId: channel.id });
  } else if (sub === 'welcome') {
    const { welcomeMessage } = await getSettings(interaction.guildId);
    drafts.set(interaction.user.id, { ...base, mode: 'welcome', blocks: structuredClone(welcomeMessage?.length ? welcomeMessage : defaultWelcome()), selected: 0 });
  } else {
    const id = String(interaction.options.getString('message', true)).match(/(\d{15,25})\s*$/)?.[1];
    const record = id && (await store.composed.get(id));
    if (!record || record.guildId !== interaction.guildId) {
      return interaction.reply(notice('bad', 'I can only edit messages made with `/message create`. Pick one from the list as you type.', { title: 'Can\'t find that message' }));
    }
    const channel = await interaction.guild.channels.fetch(record.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(record.messageId).catch(() => null);
    if (!message) {
      await store.composed.delete(record.messageId);
      return interaction.reply(notice('bad', 'That message was deleted, so there\'s nothing to edit.', { title: 'Message not found' }));
    }
    drafts.set(interaction.user.id, { ...base, mode: 'edit', channelId: record.channelId, messageId: record.messageId, blocks: structuredClone(record.blocks), selected: 0 });
  }
  return interaction.reply(ephemeral(builder(drafts.get(interaction.user.id), interaction.guild)));
}

/** The list of messages you can edit, newest first. */
export async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const list = await store.composed.list(interaction.guildId, 25);
  return interaction.respond(list
    .map((m) => ({
      name: `#${interaction.guild.channels.cache.get(m.channelId)?.name ?? 'channel'} · ${label(m.blocks.find((b) => b.type === 'card') ?? m.blocks[0])}`.slice(0, 100),
      value: m.messageId,
    }))
    .filter((c) => c.name.toLowerCase().includes(typed) || c.value.includes(typed))
    .slice(0, 25));
}

// ---------------------------------------------------------------- the builder

function builder(d, guild, error) {
  const chars = textLength(d.blocks);
  const parts = componentCount(d.blocks);
  const heading = {
    post: `-# ✍️ MESSAGE BUILDER · will be posted in <#${d.channelId}>`,
    edit: '-# ✍️ EDITING A MESSAGE · saving changes the live message',
    welcome: '-# 👋 WELCOME MESSAGE · sent when someone joins',
  }[d.mode];
  const list = d.blocks.length
    ? d.blocks.map((b, i) => `${i === d.selected ? '▶️' : '▫️'} **${i + 1}.** ${b.type === 'banner' ? '🖼️' : '📄'} ${label(b)}${b.type === 'card' ? ` · ${b.text.length.toLocaleString('en-US')} chars` : ''}`)
    : ['*Nothing yet. Add a card or a banner below.*'];

  const rows = [];
  if (d.blocks.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('message:b:pick')
      .setPlaceholder('Pick a block to change…').addOptions(d.blocks.map((b, i) => ({
        label: `${i + 1}. ${label(b)}`.slice(0, 100), value: String(i), emoji: b.type === 'banner' ? '🖼️' : '📄', default: i === d.selected,
      })))));
  }
  const sel = d.selected !== null && d.blocks[d.selected];
  if (sel) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('message:b:edit').setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('message:b:up').setLabel('Up').setEmoji('⬆️').setStyle(ButtonStyle.Secondary).setDisabled(d.selected === 0),
      new ButtonBuilder().setCustomId('message:b:down').setLabel('Down').setEmoji('⬇️').setStyle(ButtonStyle.Secondary).setDisabled(d.selected === d.blocks.length - 1),
      new ButtonBuilder().setCustomId('message:b:del').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ));
  }
  const full = d.blocks.length >= MAX_BLOCKS;
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('message:b:addcard').setLabel('Add card').setEmoji('📄').setStyle(ButtonStyle.Secondary).setDisabled(full),
    new ButtonBuilder().setCustomId('message:b:addbanner').setLabel('Add banner').setEmoji('🖼️').setStyle(ButtonStyle.Secondary).setDisabled(full),
    new ButtonBuilder().setCustomId('message:b:preview').setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary).setDisabled(!d.blocks.length),
  ));
  const finish = { post: ['Post message', '📨'], edit: ['Save changes', '💾'], welcome: ['Save welcome message', '💾'] }[d.mode];
  const done = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('message:b:finish').setLabel(finish[0]).setEmoji(finish[1]).setStyle(ButtonStyle.Success).setDisabled(!d.blocks.length),
    ...(d.mode === 'welcome' ? [new ButtonBuilder().setCustomId('message:b:reset').setLabel('Back to the default').setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setCustomId('message:b:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return v2(card(colors.brand,
    text(heading, '### Blocks in this message'),
    text(list),
    text(`-# ${chars.toLocaleString('en-US')} / ${MAX_TEXT.toLocaleString('en-US')} characters · ${parts} / ${MAX_COMPONENTS} parts · up to ${MAX_BLOCKS} blocks`),
    error ? text(`❌ ${error}`) : null,
    divider(),
    rows,
    done,
    footnote(d.mode === 'welcome'
      ? 'Placeholders: {user} {username} {server} {count} {game} · picture links can use {avatar} or {servericon}'
      : 'Each message holds up to 3,800 characters. For long rules, post several messages one after the other.'),
  ));
}

function cardModal(index, b) {
  return new ModalBuilder().setCustomId(`message:m:card:${index}`).setTitle(b ? 'Edit card' : 'New card').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Text (## Heading, **bold**, - lists)')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(3800).setValue(b?.text ?? '').setPlaceholder('## 📜 Rules\n• Be kind to everyone\n• No spam')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel(`Color (${SAMPLE_COLORS})`)
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(b?.color != null ? `#${b.color.toString(16).padStart(6, '0')}` : '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumb').setLabel('Small picture on the right (link)')
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(400).setValue(b?.thumb ?? '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Big picture at the bottom (link)')
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(400).setValue(b?.image ?? '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buttons').setLabel('Buttons (Label | link, one per line)')
      .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(700).setValue((b?.buttons ?? []).map((x) => `${x.label} | ${x.url}`).join('\n'))),
  );
}

function bannerModal(index, b) {
  return new ModalBuilder().setCustomId(`message:m:banner:${index}`).setTitle(b ? 'Edit banner' : 'New banner').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Picture link (https://…)')
      .setStyle(TextInputStyle.Short).setMaxLength(400).setValue(b?.image ?? '').setPlaceholder('https://i.imgur.com/example.png')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel(`Edge color (${SAMPLE_COLORS})`)
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20).setValue(b?.color != null ? `#${b.color.toString(16).padStart(6, '0')}` : '')),
  );
}

// ---------------------------------------------------------------- interactions

export async function handleSelect(interaction) {
  if (!canUse(interaction)) return interaction.reply(notice('bad', 'You need **Manage Server** to use this.'));
  const d = drafts.get(interaction.user.id);
  if (!d) return gone(interaction);
  d.selected = Number(interaction.values[0]);
  return interaction.update(builder(d, interaction.guild));
}

export async function handleButton(interaction) {
  if (!canUse(interaction)) return interaction.reply(notice('bad', 'You need **Manage Server** to use this.'));
  const d = drafts.get(interaction.user.id);
  if (!d) return gone(interaction);
  const action = interaction.customId.split(':')[2];
  const update = (error) => interaction.update(builder(d, interaction.guild, error));
  const sel = d.selected !== null ? d.blocks[d.selected] : null;

  switch (action) {
    case 'addcard': return interaction.showModal(cardModal('new'));
    case 'addbanner': return interaction.showModal(bannerModal('new'));
    case 'edit': return sel ? interaction.showModal(sel.type === 'banner' ? bannerModal(d.selected, sel) : cardModal(d.selected, sel)) : update();
    case 'up':
    case 'down': {
      const to = d.selected + (action === 'up' ? -1 : 1);
      if (to >= 0 && to < d.blocks.length) {
        [d.blocks[d.selected], d.blocks[to]] = [d.blocks[to], d.blocks[d.selected]];
        d.selected = to;
      }
      return update();
    }
    case 'del':
      if (sel) {
        d.blocks.splice(d.selected, 1);
        d.selected = d.blocks.length ? Math.min(d.selected, d.blocks.length - 1) : null;
      }
      return update();
    case 'preview': {
      const why = problem(d.blocks);
      if (why) return update(why);
      return interaction.reply(ephemeral(renderBlocks(d.blocks, welcomeVars(interaction.member, (await getSettings(interaction.guildId)).gameName))));
    }
    case 'cancel':
      drafts.delete(interaction.user.id);
      return interaction.update(notice('ok', 'Nothing was posted or changed.', { title: 'Cancelled', ephemeral: false }));
    case 'reset':
      drafts.delete(interaction.user.id);
      await updateSettings(interaction.guildId, { welcomeMessage: null });
      return interaction.update(notice('ok', 'New members get the standard welcome card again.', { title: 'Back to the default', ephemeral: false }));
    case 'finish': return finish(interaction, d, update);
    default: return update();
  }
}

export async function handleModal(interaction) {
  if (!canUse(interaction)) return interaction.reply(notice('bad', 'You need **Manage Server** to use this.'));
  const d = drafts.get(interaction.user.id);
  if (!d) return gone(interaction);
  const [, , kind, where] = interaction.customId.split(':');
  const get = (k) => interaction.fields.getTextInputValue(k);
  const update = (error) => interaction.update(builder(d, interaction.guild, error));

  const color = parseColor(get('color'));
  if (color.error) return update(color.error);
  let block;
  if (kind === 'banner') {
    const image = parseImage(get('image'), 'banner picture');
    if (image.error || !image.value) return update(image.error ?? 'Paste a link to the banner picture.');
    block = { type: 'banner', image: image.value, color: color.value };
  } else {
    const body = get('text').trim();
    const thumb = parseImage(get('thumb'), 'small picture');
    const image = parseImage(get('image'), 'big picture');
    const buttons = parseButtons(get('buttons'));
    const error = !body ? 'The card needs some text.' : thumb.error ?? image.error ?? buttons.error;
    if (error) return update(error);
    block = { type: 'card', text: body, color: color.value, thumb: thumb.value, image: image.value, buttons: buttons.value };
  }

  const next = [...d.blocks];
  if (where === 'new') next.push(block);
  else next[Number(where)] = block;
  const why = problem(next);
  if (why) return update(why);
  d.blocks = next;
  d.selected = where === 'new' ? next.length - 1 : Number(where);
  return update();
}

async function finish(interaction, d, update) {
  const why = problem(d.blocks);
  if (why) return update(why);

  if (d.mode === 'welcome') {
    await updateSettings(interaction.guildId, { welcomeMessage: d.blocks });
    drafts.delete(interaction.user.id);
    const { welcomeChannel } = await getSettings(interaction.guildId);
    return interaction.update(notice('ok', welcomeChannel
      ? `New members will get this in <#${welcomeChannel}>.`
      : 'Saved. Pick a **Welcome channel** in `/setup` so it knows where to send it.', { title: 'Welcome message saved', ephemeral: false }));
  }

  const channel = await interaction.guild.channels.fetch(d.channelId).catch(() => null);
  if (!channel?.isTextBased()) return update('I can\'t find that channel anymore.');

  if (d.mode === 'edit') {
    const message = await channel.messages.fetch(d.messageId).catch(() => null);
    if (!message) return update('That message was deleted, so it can\'t be edited.');
    let refused = null;
    await message.edit(renderBlocks(d.blocks)).catch((err) => { refused = err; });
    if (refused) return update(`Discord refused the change: ${refused.message}`);
    await store.composed.update(d.messageId, { blocks: d.blocks, editedAt: Date.now() });
    drafts.delete(interaction.user.id);
    return interaction.update(notice('ok', `The message in ${channel} was updated.\n${message.url}`, { title: 'Saved', ephemeral: false }));
  }

  let failure = null;
  const sent = await channel.send(renderBlocks(d.blocks)).catch((err) => { failure = err; return null; });
  if (!sent) {
    return update(`I couldn't post in ${channel}: ${failure?.message ?? 'no permission'}. Give me **Send Messages** and **Embed Links** there, and check that your picture links work.`);
  }
  await store.composed.create({ messageId: sent.id, guildId: d.guildId, channelId: channel.id, authorId: interaction.user.id, blocks: d.blocks, createdAt: Date.now() });
  drafts.delete(interaction.user.id);
  return interaction.update(notice('ok', `Posted in ${channel}.\nChange it any time with \`/message edit\`.\n${sent.url ?? ''}`.trim(), { title: 'Posted!', ephemeral: false }));
}
