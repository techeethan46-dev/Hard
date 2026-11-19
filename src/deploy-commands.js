// Registers slash commands with Discord. Render runs this before every start ("npm run deploy && npm start"), and you can
// run it by hand too:  npm run deploy
// If Discord refuses the registration, this prints a warning and still finishes normally, so the bot starts anyway.
import { REST, Routes } from 'discord.js';
import { config, requireConfig } from './config.js';
import { loadCommands } from './lib/loader.js';
import { register } from './lib/register.js';

requireConfig('token', 'clientId');
const commands = [...(await loadCommands()).values()].map((c) => c.data.toJSON());
const rest = new REST({ timeout: 20_000 }).setToken(config.token);
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId) // one server, updates instantly
  : Routes.applicationCommands(config.clientId); // every server the bot is in

const result = await register(rest, route, commands);
if (result.ok) {
  console.log(`Registered ${commands.length} commands ${config.guildId ? `on server ${config.guildId}` : 'globally'}: ${commands.map((c) => '/' + c.name).join(' ')}`);
} else {
  console.warn(`⚠️ Couldn't register the slash commands (${result.error?.message ?? result.error}). The bot will start anyway; commands Discord already knows keep working. Redeploy later to try again.`);
}
