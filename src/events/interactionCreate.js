import { Events } from 'discord.js';
import { notice } from '../lib/ui.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, commands) {
  if (!interaction.inGuild()) return;
  let command;
  if (interaction.isChatInputCommand()) command = commands.get(interaction.commandName);
  // Buttons and modals are routed by customId prefix: "ticket:close" -> commands/ticket.js
  else if (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu()) command = commands.get(interaction.customId.split(':')[0]);
  if (!command) return;

  try {
    if (interaction.isButton()) await command.handleButton?.(interaction);
    else if (interaction.isModalSubmit()) await command.handleModal?.(interaction);
    else if (interaction.isAnySelectMenu()) await command.handleSelect?.(interaction);
    else await command.execute(interaction);
  } catch (err) {
    console.error(`Error in ${interaction.commandName ?? interaction.customId}:`, err);
    const payload = notice('bad', 'Please try again in a moment. If it keeps happening, tell the staff team.', { title: 'Something went wrong' });
    const send = interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
    await send.catch(() => {});
  }
}
