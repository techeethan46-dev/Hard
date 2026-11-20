import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { dailyReward, fmt } from '../lib/economy.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { notice } from '../lib/ui.js';

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
  .addSubcommand((s) => s.setName('boost-set').setDescription('Make a role raise the /daily reward')
    .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
    .addIntegerOption((o) => o.setName('percent').setDescription('Extra percent, e.g. 20 for +20%').setRequired(true).setMinValue(1).setMaxValue(1000)))
  .addSubcommand((s) => s.setName('boost-remove').setDescription('Stop a role raising the /daily reward')
    .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
  .addSubcommand((s) => s.setName('boost-list').setDescription('See which roles raise the /daily reward'));

const MAX_BOOSTS = 10;

async function boosts(interaction, sub) {
  const list = (await getSettings(interaction.guildId)).dailyBoosts ?? [];
  if (sub === 'boost-list') {
    return interaction.reply(notice('ok', list.length
      ? list.map((b) => `<@&${b.roleId}> · **+${b.percent}%** (${fmt(dailyReward(b.percent))} a day)`).join('\n')
      : 'No boost roles yet. Add one with `/economy boost-set`.', { title: '⚡ Daily boosts' }));
  }
  const role = interaction.options.getRole('role', true);
  if (sub === 'boost-remove') {
    if (!list.some((b) => b.roleId === role.id)) return interaction.reply(notice('warn', `${role} doesn't have a boost.`));
    await updateSettings(interaction.guildId, { dailyBoosts: list.filter((b) => b.roleId !== role.id) });
    return interaction.reply(notice('ok', `${role} no longer boosts the daily reward.`, { title: 'Boost removed' }));
  }
  const percent = interaction.options.getInteger('percent', true);
  const next = [...list.filter((b) => b.roleId !== role.id), { roleId: role.id, percent }].sort((a, b) => a.percent - b.percent);
  if (next.length > MAX_BOOSTS) return interaction.reply(notice('warn', `You can have up to ${MAX_BOOSTS} boost roles.`));
  await updateSettings(interaction.guildId, { dailyBoosts: next });
  return interaction.reply(notice('ok', `${role} now gives **+${percent}%** on \`/daily\` (**${fmt(dailyReward(percent))}** a day). Only a member's best boost counts.`, { title: 'Boost saved' }));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub.startsWith('boost-')) return boosts(interaction, sub);
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
