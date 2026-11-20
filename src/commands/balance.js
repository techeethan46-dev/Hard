import { SlashCommandBuilder } from 'discord.js';
import { todayFor } from '../lib/activity.js';
import { fmt } from '../lib/economy.js';
import { getSettings } from '../lib/settings.js';
import { store } from '../lib/store.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('See how many coins you have')
  .addUserOption((o) => o.setName('member').setDescription('Someone else'));

export async function execute(interaction) {
  const user = interaction.options.getUser('member') ?? interaction.user;
  if (user.bot) return interaction.reply(notice('warn', 'Bots don\'t have wallets.'));
  const doc = (await store.stats.get(interaction.guildId, user.id)) ?? {};
  const coins = doc.coins ?? 0;
  const place = coins > 0 ? await store.stats.position(interaction.guildId, 'coins', coins) : null;
  const self = user.id === interaction.user.id;
  const claimed = doc.dailyDay === todayFor(await getSettings(interaction.guildId));

  return interaction.reply(v2(card(colors.warn,
    section([`### 🪙 ${user.displayName ?? user.username}'s wallet`, `**${fmt(coins)}**`, place ? `-# #${place} richest in the server` : '-# No coins yet'],
      thumb(user.displayAvatarURL({ size: 128 }))),
    self ? [divider(), text(claimed ? '📅 Daily reward: ✅ already claimed today' : '📅 Daily reward: 🎁 ready! Use `/daily`')] : null,
    footnote('Earn coins by chatting and with /daily · spend them in /shop or play /coinflip, /slots, /blackjack and /roulette'),
  )));
}
