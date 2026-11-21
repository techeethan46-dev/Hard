import {
  ActionRowBuilder, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { DAILY_COINS, dailyReward, fmt } from '../lib/economy.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { blockReason } from '../lib/reactionroles.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('economy')
  .setDescription('Give or take coins, and set daily boost roles (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('give').setDescription('Give coins to a member')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Coins').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
  .addSubcommand((s) => s.setName('take').setDescription('Take coins from a member (never below zero)')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Coins').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
  .addSubcommand((s) => s.setName('setup').setDescription('Set up the role shop and the daily boosts'));

// ---------------------------------------------------------------- /economy setup
// One screen for the role shop: pick a role, type its price and (optionally) how much it raises /daily.
// customIds: economy:pick (role menu) · economy:item:<roleId> (modal) · economy:remove (menu)

const MAX_ITEMS = 25;
const allowed = (i) => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
const denied = (i) => i.reply(notice('bad', 'You need the **Manage Server** permission to change the economy setup.'));

/** The shop roles and boost roles as one list: { roleId, price?, percent? }. */
function entries(settings) {
  const map = new Map();
  for (const x of settings.shopItems ?? []) map.set(x.roleId, { roleId: x.roleId, price: x.price });
  for (const b of settings.dailyBoosts ?? []) map.set(b.roleId, { ...map.get(b.roleId), roleId: b.roleId, percent: b.percent });
  return [...map.values()].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

export async function render(guild, error) {
  const list = entries(await getSettings(guild.id));
  const line = (e) => [`<@&${e.roleId}>`, e.price ? `**${fmt(e.price)}**` : '*not for sale*',
    e.percent ? `⚡ **+${e.percent}%** daily (${fmt(dailyReward(e.percent))})` : null].filter(Boolean).join(' · ');
  return v2(card(colors.warn,
    text('## 🪙 Economy setup', 'Pick a role below, then type its **price** and how much it should **raise the /daily reward**. The role goes on sale in `/shop` right away.',
      `-# /daily gives **${fmt(DAILY_COINS)}** with no boost. Members only get their best boost, never several added together.`),
    divider(),
    text('**Shop roles**', ...(list.length ? list.map(line) : ['Nothing yet. Pick a role to start.'])),
    error ? text(`⚠️ ${error}`) : null,
    divider(),
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('economy:pick').setPlaceholder('Add a role, or pick one to change it…')),
    list.length
      ? new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('economy:remove').setPlaceholder('Remove a role…').addOptions(
        list.map((e) => ({ label: (guild.roles.cache.get(e.roleId)?.name ?? 'role').slice(0, 100), value: e.roleId }))))
      : null,
    footnote('Changes save as soon as you submit them'),
  ), { ephemeral: true });
}

export async function handleSelect(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action] = interaction.customId.split(':');
  const roleId = interaction.values[0];

  if (action === 'pick') {
    const why = blockReason(interaction.guild, interaction.guild.roles.cache.get(roleId));
    if (why) return interaction.update(await render(interaction.guild, `<@&${roleId}> can't be sold: it ${why}.`));
    const have = entries(await getSettings(interaction.guildId)).find((e) => e.roleId === roleId);
    const name = interaction.guild.roles.cache.get(roleId)?.name ?? 'role';
    const price = new TextInputBuilder().setCustomId('price').setLabel('Price in coins').setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 1500').setMaxLength(8).setRequired(true);
    const boost = new TextInputBuilder().setCustomId('percent').setLabel('Daily boost % (0 for none)').setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 20 gives +20% on /daily').setMaxLength(4).setRequired(false);
    if (have?.price) price.setValue(String(have.price));
    if (have?.percent) boost.setValue(String(have.percent));
    return interaction.showModal(new ModalBuilder().setCustomId(`economy:item:${roleId}`).setTitle(`@${name}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(price), new ActionRowBuilder().addComponents(boost)));
  }

  if (action === 'remove') {
    const settings = await getSettings(interaction.guildId);
    await updateSettings(interaction.guildId, {
      shopItems: (settings.shopItems ?? []).filter((x) => x.roleId !== roleId),
      dailyBoosts: (settings.dailyBoosts ?? []).filter((b) => b.roleId !== roleId),
    });
    return interaction.update(await render(interaction.guild));
  }
}

export async function handleModal(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const roleId = interaction.customId.split(':')[2];
  const price = Number(interaction.fields.getTextInputValue('price').trim().replace(/[,\s]/g, ''));
  const rawPercent = interaction.fields.getTextInputValue('percent').trim();
  const percent = rawPercent === '' ? 0 : Number(rawPercent.replace('%', ''));

  if (!Number.isInteger(price) || price < 1 || price > 10_000_000) return interaction.update(await render(interaction.guild, 'The price must be a whole number from 1 to 10,000,000.'));
  if (!Number.isInteger(percent) || percent < 0 || percent > 1000) return interaction.update(await render(interaction.guild, 'The boost must be a whole number from 0 to 1000 (0 means no boost).'));
  const why = blockReason(interaction.guild, interaction.guild.roles.cache.get(roleId));
  if (why) return interaction.update(await render(interaction.guild, `<@&${roleId}> can't be sold: it ${why}.`));

  const settings = await getSettings(interaction.guildId);
  const items = (settings.shopItems ?? []).filter((x) => x.roleId !== roleId);
  if (items.length >= MAX_ITEMS) return interaction.update(await render(interaction.guild, `The shop holds up to ${MAX_ITEMS} roles.`));
  const boosts = (settings.dailyBoosts ?? []).filter((b) => b.roleId !== roleId);
  await updateSettings(interaction.guildId, {
    shopItems: [...items, { roleId, price }].sort((a, b) => a.price - b.price),
    dailyBoosts: (percent ? [...boosts, { roleId, percent }] : boosts).sort((a, b) => a.percent - b.percent),
  });
  return interaction.update(await render(interaction.guild));
}

export async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'setup') return interaction.reply(await render(interaction.guild));
  const user = interaction.options.getUser('member', true);
  if (user.bot) return interaction.reply(notice('warn', 'Bots don\'t have coins.'));
  const amount = interaction.options.getInteger('amount', true);

  if (interaction.options.getSubcommand() === 'give') {
    const doc = await store.stats.addCoins(interaction.guildId, user.id, amount);
    return interaction.reply(notice('ok', `${user} received **${fmt(amount)}** and now has **${fmt(doc.coins)}**.`, { title: 'Coins given' }));
  }
  const have = (await store.stats.get(interaction.guildId, user.id))?.coins ?? 0;
  const taking = Math.min(amount, have);
  const doc = taking > 0 ? await store.stats.spend(interaction.guildId, user.id, taking) : { coins: have };
  return interaction.reply(notice('ok', `Took **${fmt(taking)}** from ${user}. They now have **${fmt(doc?.coins ?? 0)}**.`, { title: 'Coins taken' }));
}
