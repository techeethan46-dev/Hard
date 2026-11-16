import { Events, MessageFlags } from 'discord.js';
import { colors, embed } from '../lib/ui.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, commands) {
  if (!interaction.inGuild()) return;
  let command;
  if (interaction.isChatInputCommand()) command = commands.get(interaction.commandName);
  else if (interaction.isButton()) command = commands.get(interaction.customId.split(':')[0]);
  if (!command) return;

  try {
    if (interaction.isButton()) await command.handleButton?.(interaction);
    else await command.execute(interaction);
  } catch (err) {
    console.error(`Error in ${interaction.commandName ?? interaction.customId}:`, err);
    const payload = { flags: MessageFlags.Ephemeral, embeds: [embed(colors.bad).setDescription('Something went wrong. Please try again in a moment.')] };
    const send = interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
    await send.catch(() => {});
  }
}
