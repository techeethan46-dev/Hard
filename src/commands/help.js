import { ActionRowBuilder, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';
import { loadCommands } from '../lib/loader.js';
import { card, colors, divider, footnote, text, v2 } from '../lib/ui.js';

// /help: a private card listing the commands, grouped. It reads the bot's real commands, so a new command
// can never be forgotten (anything not listed below lands in "Other"), and it only shows people the
// commands they are allowed to use.

export const data = new SlashCommandBuilder().setName('help').setDescription('See what the bot can do');

export const CATEGORIES = [
  {
    id: 'start', emoji: '🙋', title: 'Getting started', blurb: 'Link your Roblox account and look things up',
    commands: ['verify', 'unverify', 'update', 'whois', 'game'],
    extras: [{ usage: 'r!afk <reason>', text: 'Go AFK, e.g. `r!afk Too tired`. People who ping you are told why, and you\'re back when you chat.' }],
  },
  {
    id: 'levels', emoji: '⭐', title: 'Levels & streaks', blurb: 'Your level, the leaderboard and your daily 🔥 streak',
    commands: ['rank', 'leaderboard', 'streak', 'xp', 'streak-admin'],
  },
  {
    id: 'community', emoji: '🎉', title: 'Community', blurb: 'Suggestions, support tickets, giveaways and role panels',
    commands: ['suggest', 'ticket', 'giveaway', 'roles', 'sticky', 'message'],
    extras: [{ usage: 'Support tickets', text: 'Use the ticket buttons in the support channel to open a private chat with staff.' }],
  },
  {
    id: 'mod', emoji: '🛡️', title: 'Moderation', blurb: 'Warnings, timeouts, bans and raid protection',
    commands: ['warn', 'warnings', 'timeout', 'kick', 'ban', 'purge', 'raidmode'],
  },
  { id: 'setup', emoji: '⚙️', title: 'Setup', blurb: 'Set the bot up and post its panels', commands: ['setup', 'panel'] },
];

let commandsCache;
const loaded = () => (commandsCache ??= loadCommands());

/** Can this person use the command? (Commands with required permissions are hidden from everyone else.) */
const allowed = (json, perms) => {
  if (!json.default_member_permissions) return true;
  return Boolean(perms?.has(BigInt(json.default_member_permissions)));
};

// One command as lines: its name and description, then its sub-commands in small text.
function describe(json) {
  const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  return [`**/${json.name}** · ${json.description}`, subs.length ? `-# ${subs.join(' · ')}` : null].filter(Boolean);
}

/** The categories this person can see, each with its command lines. Unlisted commands go to "Other". */
export function visibleCategories(commands, perms) {
  const jsons = new Map([...commands].map(([name, mod]) => [name, mod.data.toJSON()]));
  const listed = new Set(CATEGORIES.flatMap((c) => c.commands));
  const all = [...CATEGORIES];
  const rest = [...jsons.keys()].filter((n) => !listed.has(n) && n !== 'help');
  if (rest.length) all.push({ id: 'other', emoji: '📦', title: 'Other', blurb: 'More commands', commands: rest });

  return all.map((c) => {
    const lines = c.commands.filter((n) => jsons.has(n)).map((n) => jsons.get(n)).filter((j) => allowed(j, perms)).flatMap(describe);
    const extras = (c.extras ?? []).map((e) => `**${e.usage}** · ${e.text}`);
    const count = lines.filter((l) => l.startsWith('**/')).length + extras.length;
    return { ...c, lines: [...lines, ...extras], count };
  }).filter((c) => c.count > 0);
}

/** The /help message: the home page, or one category's page. */
export function helpMessage(commands, perms, botName, current = 'home', ephemeral = true) {
  const cats = visibleCategories(commands, perms);
  const page = cats.find((c) => c.id === current);

  const picker = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help:pick')
    .setPlaceholder('Pick a category…').addOptions(
      { label: 'Home', value: 'home', emoji: '📖', default: !page },
      ...cats.map((c) => ({ label: c.title, value: c.id, emoji: c.emoji, description: c.blurb.slice(0, 100), default: page?.id === c.id })),
    ));

  if (!page) {
    return v2(card(colors.brand,
      text(`## 📖 ${botName} · Help`,
        'I link Roblox accounts, track levels and daily streaks, run tickets and giveaways, and keep the server safe.',
        '**Pick a category below** to see what you can do.'),
      divider(),
      text(cats.map((c) => `${c.emoji} **${c.title}** · ${c.count} command${c.count === 1 ? '' : 's'}\n-# ${c.blurb}`)),
      divider(),
      picker,
      footnote('New here? Start with /verify · type / in the chat to see every command · you only see commands you can use'),
    ), { ephemeral });
  }
  return v2(card(colors.brand,
    text(`## ${page.emoji} ${page.title}`, `-# ${page.blurb}`),
    divider(),
    text(page.lines),
    divider(),
    picker,
    footnote('Pick Home in the menu to go back'),
  ), { ephemeral });
}

export async function execute(interaction) {
  return interaction.reply(helpMessage(await loaded(), interaction.memberPermissions, interaction.client.user?.username ?? 'Bot'));
}

export async function handleSelect(interaction) {
  const msg = helpMessage(await loaded(), interaction.memberPermissions, interaction.client.user?.username ?? 'Bot', interaction.values[0], false);
  return interaction.update(msg);
}
