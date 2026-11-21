import { SlashCommandBuilder } from 'discord.js';
import { credit } from '../lib/bank.js';
import { fmt, taxOn } from '../lib/economy.js';
import { store } from '../lib/store.js';
import { notice } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('pay')
  .setDescription('Send some of your coins to someone')
  .addUserOption((o) => o.setName('member').setDescription('Who gets the coins').setRequired(true))
  .addIntegerOption((o) => o.setName('amount').setDescription('How many coins').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000));

export async function execute(interaction) {
  const to = interaction.options.getUser('member', true);
  const amount = interaction.options.getInteger('amount', true);
  if (to.bot) return interaction.reply(notice('warn', 'Bots can\'t use coins.'));
  if (to.id === interaction.user.id) return interaction.reply(notice('warn', 'You can\'t pay yourself.'));

  const left = await store.stats.spend(interaction.guildId, interaction.user.id, amount);
  if (!left) {
    const have = (await store.stats.get(interaction.guildId, interaction.user.id))?.coins ?? 0;
    return interaction.reply(notice('bad', `You only have **${fmt(have)}**.`, { title: 'Not enough coins' }));
  }
  // The receiver gets the coins minus the tax, which goes to the bank.
  const tax = taxOn(amount);
  if (tax > 0) await store.bank.add(interaction.guildId, tax);
  await credit(interaction.guildId, to.id, amount - tax);
  return interaction.reply(notice('ok', `You sent **${fmt(amount)}** to ${to}.\n${to} received **${fmt(amount - tax)}** after the **${fmt(tax)}** tax (it went to the bank).\n-# You have ${fmt(left.coins)} left`, { title: 'Coins sent' }));
}
