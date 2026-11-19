import { Events } from 'discord.js';
import { reportError } from '../lib/errors.js';
import { notice } from '../lib/ui.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, commands) {
  if (!interaction.inGuild()) return;
  if (interaction.isAutocomplete()) {
    return Promise.resolve(commands.get(interaction.commandName)?.autocomplete?.(interaction))
      .catch((err) => console.error('Autocomplete failed:', err.message));
  }
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
    reportError(interaction.client, {
      where: interaction.commandName ? `/${interaction.commandName}` : `a button or menu (${String(interaction.customId).split(':').slice(0, 2).join(':')})`,
      error: err, guildId: interaction.guildId, user: interaction.user?.username,
    });
    const payload = notice('bad', 'Please try again in a moment. If it keeps happening, tell the staff team.', { title: 'Something went wrong' });
    const send = interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
    await send.catch(() => {});
  }
}
