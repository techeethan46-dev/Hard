import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { oauthEnabled } from '../config.js';
import { createAuthUrl } from '../lib/oauth.js';
import { getHeadshotUrl, getUser, getUserByUsername, profileUrl } from '../lib/roblox.js';
import { store } from '../lib/store.js';
import { linkAccount } from '../lib/verification.js';
import { card, colors, divider, footnote, notice, section, text, thumb, v2 } from '../lib/ui.js';

// Two ways to verify:
//  1. "Sign in with Roblox" (OAuth) — one click + approve. Used when ROBLOX_OAUTH_* and PUBLIC_URL are set.
//  2. Profile code — paste a word code into your Roblox About. Fallback, or `/verify username:<name>`.

const CODE_TTL_MS = 15 * 60_000;
// Plain words survive Roblox's text filter better than random letters/numbers.
const WORDS = [
  'apple', 'banana', 'castle', 'dragon', 'forest', 'galaxy', 'harbor', 'island', 'jungle', 'kitten',
  'lantern', 'meadow', 'nebula', 'ocean', 'pepper', 'rocket', 'silver', 'thunder', 'valley', 'window',
  'yellow', 'zebra', 'cactus', 'pillow', 'garden', 'turtle', 'planet', 'violin', 'marble', 'canyon',
];
const makeCode = () => Array.from({ length: 6 }, () => WORDS[randomInt(WORDS.length)]).join(' ');

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Link your Roblox account to Discord')
  .addStringOption((o) =>
    o.setName('username').setDescription('Your Roblox username (only needed for the profile-code method)').setMaxLength(20),
  );

export async function execute(interaction) {
  const username = interaction.options.getString('username');
  if (username) return startCodeFlow(interaction, username);
  return start(interaction);
}

export async function handleButton(interaction) {
  if (interaction.customId === 'verify:start') return start(interaction); // from the /panel verify button
  if (interaction.customId === 'verify:check') return checkCode(interaction);
}

export async function handleModal(interaction) {
  return startCodeFlow(interaction, interaction.fields.getTextInputValue('username'));
}

/** Default path: OAuth if configured, otherwise ask for a username and use the code method. */
async function start(interaction) {
  if (!oauthEnabled()) {
    const modal = new ModalBuilder().setCustomId('verify:modal').setTitle('Verify your Roblox account').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('username').setLabel('Roblox username').setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. builderman').setMinLength(3).setMaxLength(20).setRequired(true),
      ),
    );
    return interaction.showModal(modal);
  }

  const linked = await store.links.get(interaction.user.id);
  const url = createAuthUrl({
    discordId: interaction.user.id,
    guildId: interaction.guildId,
    // Update this ephemeral message once they finish signing in (the token is valid for 15 minutes).
    onDone: async (roblox, result) => interaction.editReply(await verifiedCard(roblox.username, roblox.robloxId, result)),
  });
  return interaction.reply(v2(card(colors.roblox,
    text(
      '### 🔐 Sign in with Roblox',
      'Press the button, log in if Roblox asks, then press **Confirm**. Your roles show up right away.',
      linked ? `\n-# You're linked to **${linked.username}** now. Signing in with another account switches it.` : null,
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Sign in with Roblox').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(url),
    ),
    footnote('This link is only for you and expires in 10 minutes · we never see your password'),
  ), { ephemeral: true }));
}

async function startCodeFlow(interaction, username) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await getUserByUsername(username);
  if (!user) {
    return interaction.editReply(notice('bad', `There's no Roblox account called **${username}**. Check the spelling and try again.`, { ephemeral: false }));
  }

  const existing = await store.links.get(interaction.user.id);
  if (existing?.robloxId === user.id) {
    return interaction.editReply(notice('ok', `You're already linked to **${user.name}**. Use \`/update\` to refresh your roles.`, { ephemeral: false }));
  }

  const code = makeCode();
  const expiresAt = Date.now() + CODE_TTL_MS;
  await store.pending.set(interaction.user.id, { robloxId: user.id, username: user.name, code, expiresAt });

  return interaction.editReply(v2(card(colors.roblox,
    section([`### Verify as ${user.displayName}`, `-# @${user.name} · not you? run \`/verify\` again`],
      thumb(await getHeadshotUrl(user.id).catch(() => null))),
    divider(),
    text('**1 · Copy this code**', `\`\`\`${code}\`\`\``),
    text(`**2 · Paste it in your profile**`, `Open [your Roblox profile](${profileUrl(user.id)}), paste it anywhere in **About**, and save.`),
    text('**3 · Press Done**'),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:check').setLabel('Done').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setLabel('Open profile').setEmoji('👤').setStyle(ButtonStyle.Link).setURL(profileUrl(user.id)),
    ),
    footnote(`Code expires <t:${Math.floor(expiresAt / 1000)}:R> · you can remove it from your profile afterwards`),
  )));
}

async function checkCode(interaction) {
  const pending = await store.pending.get(interaction.user.id);
  if (!pending || pending.expiresAt < Date.now()) {
    await store.pending.delete(interaction.user.id);
    return interaction.update(notice('bad', 'That code expired. Run `/verify` again to get a new one.', { title: 'Code expired', ephemeral: false }));
  }

  await interaction.deferUpdate();
  const profile = await getUser(pending.robloxId);
  const normalize = (s) => (s ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!normalize(profile?.description).includes(normalize(pending.code))) {
    return interaction.followUp(notice('warn',
      "The code isn't in your profile's **About** yet. Make sure you pressed **Save** on Roblox, wait a few seconds, then press **Done** again.",
      { title: 'Not found yet' }));
  }

  const result = await linkAccount(interaction.member, pending);
  return interaction.editReply(await verifiedCard(pending.username, pending.robloxId, result, 'You can remove the code from your profile now.'));
}

async function verifiedCard(username, robloxId, result, extra) {
  const gained = result.added.map((id) => `➕ <@&${id}>`);
  return v2(card(colors.ok,
    section([`### 🎉 You're verified!`, `Linked to **${username}**`, ...(result.nickname ? [`-# Nickname set to ${result.nickname}`] : [])],
      thumb(await getHeadshotUrl(robloxId).catch(() => null))),
    gained.length || result.errors.length ? divider() : null,
    gained.length ? text(gained) : null,
    result.errors.length ? text(result.errors.map((e) => `⚠️ ${e}`)) : null,
    footnote(extra ?? 'Welcome in! Use /update any time to refresh your roles.'),
  ));
}
