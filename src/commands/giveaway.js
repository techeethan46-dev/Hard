import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  endGiveaway, endedCard, giveawayCard, parseDuration, refreshSoon, reroll, whyNot,
} from '../lib/giveaways.js';
import { store } from '../lib/store.js';
import { card, colors, footnote, notice, text, v2 } from '../lib/ui.js';

const MIN = 60_000;
const MAX = 30 * 86_400_000;

const pick = (o, desc) => o.setName('giveaway').setDescription(desc).setRequired(true).setAutocomplete(true);
export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Run giveaways')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway')
    .addStringOption((o) => o.setName('prize').setDescription('What they win, e.g. 1,000 Robux').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('duration').setDescription('How long: 30m, 2h, 1d, 1w, 1d12h').setRequired(true).setMaxLength(20))
    .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(20))
    .addStringOption((o) => o.setName('description').setDescription('Extra details shown under the prize').setMaxLength(300))
    .addRoleOption((o) => o.setName('required_role').setDescription('Only people with this role can enter'))
    .addIntegerOption((o) => o.setName('min_level').setDescription('Minimum level to enter').setMinValue(1).setMaxValue(500))
    .addBooleanOption((o) => o.setName('must_verify').setDescription('Only people with a linked Roblox account can enter'))
    .addRoleOption((o) => o.setName('bonus_role').setDescription('This role gets 2× entries (e.g. Server Booster)'))
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now and pick winners')
    .addStringOption((o) => pick(o, 'Which giveaway')))
  .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winner(s) for an ended giveaway')
    .addStringOption((o) => pick(o, 'Which giveaway'))
    .addIntegerOption((o) => o.setName('winners').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)))
  .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway without picking anyone')
    .addStringOption((o) => pick(o, 'Which giveaway')))
  .addSubcommand((s) => s.setName('list').setDescription('See running giveaways'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return start(interaction);
  if (sub === 'list') return list(interaction);

  const id = interaction.options.getString('giveaway', true);
  const g = await store.giveaways.get(id);
  if (!g || g.guildId !== interaction.guildId) return interaction.reply(notice('bad', 'I can\'t find that giveaway. Pick one from the list as you type.'));

  if (sub === 'end') {
    if (g.ended) return interaction.reply(notice('warn', 'That giveaway has already ended. Use `/giveaway reroll` to pick someone new.'));
    await interaction.deferReply({ flags: 64 });
    const done = await endGiveaway(interaction.client, id);
    return interaction.editReply(notice('ok', done?.winnerIds.length
      ? `Winner${done.winnerIds.length === 1 ? '' : 's'}: ${done.winnerIds.map((w) => `<@${w}>`).join(' ')}`
      : 'It ended, but nobody eligible had entered.', { title: `🎉 ${g.prize} ended`, ephemeral: false }));
  }

  if (sub === 'reroll') {
    if (!g.ended) return interaction.reply(notice('warn', 'That giveaway is still running. End it first with `/giveaway end`.'));
    await interaction.deferReply({ flags: 64 });
    const fresh = await reroll(interaction.client, id, interaction.options.getInteger('winners') ?? 1);
    return interaction.editReply(fresh?.length
      ? notice('ok', `New winner${fresh.length === 1 ? '' : 's'}: ${fresh.map((w) => `<@${w}>`).join(' ')}`, { title: '🔁 Rerolled', ephemeral: false })
      : notice('warn', 'There\'s nobody left to pick: everyone eligible has already won.', { ephemeral: false }));
  }

  // cancel
  if (g.ended) return interaction.reply(notice('warn', 'That giveaway has already ended.'));
  await store.giveaways.finish(id);
  await store.giveaways.update(id, { cancelled: true, winnerIds: [] });
  const channel = await interaction.guild.channels.fetch(g.channelId).catch(() => null);
  const message = await channel?.messages.fetch(id).catch(() => null);
  await message?.edit(endedCard({ ...g, cancelled: true, winnerIds: [], endedAt: Date.now(), entryCount: g.entries.length }, interaction.guild)).catch(() => {});
  return interaction.reply(notice('ok', `**${g.prize}** was cancelled. Nobody was picked.`, { title: 'Giveaway cancelled' }));
}

async function start(interaction) {
  const o = interaction.options;
  const ms = parseDuration(o.getString('duration', true));
  if (!ms || ms < MIN || ms > MAX) {
    return interaction.reply(notice('bad', 'Use a duration between **1 minute** and **30 days**, like `30m`, `2h`, `1d`, `1w` or `1d12h`.', { title: 'Invalid duration' }));
  }
  const channel = o.getChannel('channel') ?? interaction.channel;
  const g = {
    guildId: interaction.guildId, channelId: channel.id, hostId: interaction.user.id,
    prize: o.getString('prize', true), description: o.getString('description'), winners: o.getInteger('winners') ?? 1,
    endsAt: Date.now() + ms,
    requirements: {
      roleId: o.getRole('required_role')?.id ?? null, level: o.getInteger('min_level') ?? null, verified: o.getBoolean('must_verify') ?? false,
    },
    bonusRoleId: o.getRole('bonus_role')?.id ?? null,
  };
  const message = await channel.send(giveawayCard({ ...g, entryCount: 0 }, interaction.guild)).catch(() => null);
  if (!message) return interaction.reply(notice('bad', `I can't post in ${channel}. Give me **Send Messages** there.`));
  await store.giveaways.create({ ...g, messageId: message.id });
  return interaction.reply(notice('ok', `**${g.prize}** is live in ${channel}! It ends <t:${Math.floor(g.endsAt / 1000)}:R>.`, { title: '🎉 Giveaway started' }));
}

async function list(interaction) {
  const running = await store.giveaways.list(interaction.guildId, { ended: false });
  return interaction.reply(v2(card(colors.brand,
    text('### 🎉 Running giveaways', running.length
      ? running.map((g) => `🎁 **${g.prize}** · ends <t:${Math.floor(g.endsAt / 1000)}:R> · [jump](https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId})`)
      : ['None right now. Start one with `/giveaway start`.']),
    footnote('End, reroll or cancel with /giveaway and pick it from the list'),
  ), { ephemeral: true }));
}

/** Suggests giveaways by prize while typing the "giveaway" option. */
export async function autocomplete(interaction) {
  const sub = interaction.options.getSubcommand();
  const typed = interaction.options.getFocused().toLowerCase();
  const all = await store.giveaways.list(interaction.guildId, sub === 'reroll' ? { ended: true } : { ended: false });
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  return interaction.respond(all
    .filter((g) => !g.cancelled && g.prize.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((g) => ({ name: `${g.prize} · ${g.ended ? 'ended' : 'ends'} ${fmt(g.endsAt)} UTC`.slice(0, 100), value: g.messageId })));
}

// ---------------------------------------------------------------- buttons

export async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  const messageId = id ?? interaction.message.id;

  if (action === 'leave') {
    const n = await store.giveaways.leave(messageId, interaction.user.id);
    if (n === null) return interaction.update(notice('warn', 'That giveaway has ended.', { ephemeral: false }));
    const channel = await interaction.guild.channels.fetch((await store.giveaways.get(messageId)).channelId).catch(() => null);
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    if (message) refreshSoon(message, messageId);
    return interaction.update(notice('ok', 'You left the giveaway. Changed your mind? Click **Enter giveaway** again.', { ephemeral: false }));
  }

  if (action !== 'enter') return;
  const g = await store.giveaways.get(messageId);
  if (!g || g.ended) return interaction.reply(notice('warn', 'This giveaway has ended.'));
  const leave = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:leave:${messageId}`).setLabel('Leave giveaway').setStyle(ButtonStyle.Danger),
  );

  if (g.entries.includes(interaction.user.id)) {
    return interaction.reply(v2(card(colors.brand, text('### 🎟️ You\'re already in!', 'Good luck! Winners are picked when the timer runs out.'), leave), { ephemeral: true }));
  }
  const why = await whyNot(g, interaction.member);
  if (why) return interaction.reply(notice('bad', `Sorry, ${why}.`, { title: 'You can\'t enter yet' }));

  const n = await store.giveaways.enter(messageId, interaction.user.id);
  if (n === null) return interaction.reply(notice('warn', 'This giveaway has ended.'));
  refreshSoon(interaction.message, messageId);
  const bonus = g.bonusRoleId && interaction.member.roles.cache.has(g.bonusRoleId);
  return interaction.reply(v2(card(colors.ok,
    text('### 🎉 You\'re in!', `You're one of **${n.toLocaleString('en-US')}** entries for **${g.prize}**.${bonus ? `\n💎 Your <@&${g.bonusRoleId}> role gives you **2× entries**!` : ''}`),
    leave,
    footnote(`Winners are picked <t:${Math.floor(g.endsAt / 1000)}:R> · good luck!`),
  ), { ephemeral: true }));
}
