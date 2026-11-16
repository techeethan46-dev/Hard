import { SlashCommandBuilder } from 'discord.js';
import { getSettings } from '../lib/settings.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Suggest something for the game')
  .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(1000));

export async function execute(interaction) {
  const { suggestionsChannel } = await getSettings(interaction.guildId);
  const channel = suggestionsChannel && (await interaction.guild.channels.fetch(suggestionsChannel).catch(() => null));
  if (!channel?.isTextBased()) {
    return interaction.reply(notice('warn', 'Suggestions are not set up yet. An admin can pick a channel with `/setup`.'));
  }
  const idea = interaction.options.getString('idea', true);
  const msg = await channel.send(v2(card(colors.brand,
    section([`### 💡 New suggestion`, `-# from ${interaction.user} · <t:${Math.floor(Date.now() / 1000)}:R>`],
      thumb(interaction.user.displayAvatarURL({ size: 128 }))),
    divider(),
    text(idea.split('\n').map((l) => `> ${l}`).join('\n')),
    divider(),
    footnote('Vote with 👍 / 👎 below · discuss in the thread'),
  )));
  await msg.react('👍');
  await msg.react('👎');
  await msg.startThread({ name: `💬 ${idea}`.slice(0, 100) }).catch(() => {});
  return interaction.reply(notice('ok', `Thanks! Your idea is up for votes in ${msg.url}`, { title: 'Suggestion posted' }));
}
