import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';
import { fmt } from '../lib/economy.js';
import { blockReason } from '../lib/reactionroles.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, text, v2 } from '../lib/ui.js';

// A role shop: staff put roles up for sale in /economy setup, members buy them with coins here.
export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Buy roles with your coins')
  .addSubcommand((s) => s.setName('view').setDescription('See what is for sale'));

export async function execute(interaction) {
  const items = (await getSettings(interaction.guildId)).shopItems ?? [];

  const coins = (await store.stats.get(interaction.guildId, interaction.user.id))?.coins ?? 0;
  const own = (id) => interaction.member?.roles?.cache?.has(id);
  const boosts = (await getSettings(interaction.guildId)).dailyBoosts ?? [];
  const perk = (id) => { const b = boosts.find((x) => x.roleId === id); return b ? ` · ⚡ +${b.percent}% daily` : ''; };
  return interaction.reply(v2(card(colors.warn,
    text('### 🛒 Role shop', `You have **${fmt(coins)}**`),
    divider(),
    text(items.length
      ? items.map((x) => `<@&${x.roleId}> · **${fmt(x.price)}**${perk(x.roleId)}${own(x.roleId) ? ' ✅ owned' : ''}`)
      : ['Nothing for sale yet. Staff can add roles with `/economy setup`.']),
    items.length
      ? new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('shop:pick').setPlaceholder('Pick a role to buy…').addOptions(
        items.map((x) => ({ label: (interaction.guild.roles.cache.get(x.roleId)?.name ?? 'role').slice(0, 100), value: x.roleId, description: `${fmt(x.price)}${perk(x.roleId)}${own(x.roleId) ? ' · you own this' : ''}` })),
      ))
      : null,
    footnote('Earn coins by chatting and with /daily'),
  ), { ephemeral: true }));
}

/** Picking a role asks you to confirm, so a slip of the thumb doesn't spend your coins. */
export async function handleSelect(interaction) {
  const roleId = interaction.values[0];
  const item = ((await getSettings(interaction.guildId)).shopItems ?? []).find((x) => x.roleId === roleId);
  if (!item) return interaction.reply(notice('warn', 'That role isn\'t for sale anymore.'));
  const coins = (await store.stats.get(interaction.guildId, interaction.user.id))?.coins ?? 0;
  return interaction.reply(v2(card(colors.brand,
    text('### 🛒 Buy this role?', `<@&${roleId}> for **${fmt(item.price)}**`, `-# You have ${fmt(coins)}`),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`shop:buy:${roleId}`).setLabel('Buy').setEmoji('🛒').setStyle(ButtonStyle.Success)),
    footnote('Not sure? Just dismiss this message'),
  ), { ephemeral: true }));
}

export async function handleButton(interaction) {
  const roleId = interaction.customId.split(':')[2];
  const item = ((await getSettings(interaction.guildId)).shopItems ?? []).find((x) => x.roleId === roleId);
  const role = interaction.guild.roles.cache.get(roleId);
  const done = (kind, message, title) => interaction.update(notice(kind, message, { title, ephemeral: false }));
  if (!item || !role) return done('warn', 'That role isn\'t for sale anymore.');
  const why = blockReason(interaction.guild, role);
  if (why) return done('bad', `That role can't be given out right now: it ${why}. Tell the staff.`, 'Can\'t buy that');
  if (interaction.member.roles.cache.has(roleId)) return done('warn', `You already have ${role}.`, 'Already yours');

  const left = await store.stats.spend(interaction.guildId, interaction.user.id, item.price);
  if (!left) {
    const have = (await store.stats.get(interaction.guildId, interaction.user.id))?.coins ?? 0;
    return done('bad', `${role} costs **${fmt(item.price)}** and you have **${fmt(have)}**.`, 'Not enough coins');
  }
  try {
    await interaction.member.roles.add(roleId, 'Bought in the shop');
  } catch {
    await store.stats.addCoins(interaction.guildId, interaction.user.id, item.price); // give the coins back
    return done('bad', 'I couldn\'t give you the role, so you weren\'t charged. Tell the staff.', 'Something went wrong');
  }
  return done('ok', `You bought ${role} for **${fmt(item.price)}**!\n-# You have ${fmt(left.coins)} left`, 'Purchase complete');
}
