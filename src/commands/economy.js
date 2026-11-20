import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { fmt } from '../lib/economy.js';
import { store } from '../lib/store.js';
import { notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('economy')
  .setDescription('Give or take someone\'s coins (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('give').setDescription('Give coins to a member')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Coins').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)))
  .addSubcommand((s) => s.setName('take').setDescription('Take coins from a member (never below zero)')
    .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Coins').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)));

export async function execute(interaction) {
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
