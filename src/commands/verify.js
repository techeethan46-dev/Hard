import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import { oauthEnabled } from '../config.js';
import { createAuthUrl } from '../lib/oauth.js';
import { getUser, getUserByUsername, profileUrl } from '../lib/roblox.js';
import { store } from '../lib/store.js';
import { linkAccount } from '../lib/verification.js';
import { colors, embed } from '../lib/ui.js';

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
          .setMinLength(3).setMaxLength(20).setRequired(true),
      ),
    );
    return interaction.showModal(modal);
  }

  const linked = await store.links.get(interaction.user.id);
  const url = createAuthUrl({
    discordId: interaction.user.id,
    guildId: interaction.guildId,
    // Update this ephemeral message once they finish signing in (the token is valid for 15 minutes).
    onDone: (roblox, result) => interaction.editReply({ embeds: [verifiedEmbed(roblox.username, result)], components: [] }),
  });
  const e = embed()
    .setTitle('Verify with Roblox')
    .setDescription(
      [
        'Click **Sign in with Roblox**, log in if asked, and press **Confirm**. That\'s it — you\'ll get your roles right away.',
        linked ? `\nYou're currently linked to **${linked.username}**. Signing in with another account will switch it.` : '',
        '\n-# The link is just for you and expires in 10 minutes. We only see your username and avatar — never your password.',
      ].join(''),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Sign in with Roblox').setStyle(ButtonStyle.Link).setURL(url),
  );
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [e], components: [row] });
}

async function startCodeFlow(interaction, username) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await getUserByUsername(username);
  if (!user) {
    return interaction.editReply({ embeds: [embed(colors.bad).setDescription('No Roblox user has that username.')] });
  }

  const existing = await store.links.get(interaction.user.id);
  if (existing?.robloxId === user.id) {
    return interaction.editReply({
      embeds: [embed(colors.ok).setDescription(`You're already linked to **${user.name}**. Use \`/update\` to refresh your roles.`)],
    });
  }

  const code = makeCode();
  await store.pending.set(interaction.user.id, { robloxId: user.id, username: user.name, code, expiresAt: Date.now() + CODE_TTL_MS });

  const e = embed()
    .setTitle(`Verify as ${user.displayName} (@${user.name})`)
    .setDescription(
      [
        '**1.** Copy this code:',
        `\`\`\`${code}\`\`\``,
        `**2.** Paste it anywhere in the **About** section of [your Roblox profile](${profileUrl(user.id)}) and save.`,
        '**3.** Press **Done** below.',
        '',
        `You can delete the code from your profile once you're verified. This code expires <t:${Math.floor((Date.now() + CODE_TTL_MS) / 1000)}:R>.`,
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:check').setLabel('Done').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setLabel('Open profile').setStyle(ButtonStyle.Link).setURL(profileUrl(user.id)),
  );
  return interaction.editReply({ embeds: [e], components: [row] });
}

async function checkCode(interaction) {
  const pending = await store.pending.get(interaction.user.id);
  if (!pending || pending.expiresAt < Date.now()) {
    await store.pending.delete(interaction.user.id);
    return interaction.update({
      embeds: [embed(colors.bad).setDescription('That code expired. Run `/verify` again to get a new one.')],
      components: [],
    });
  }

  await interaction.deferUpdate();
  const profile = await getUser(pending.robloxId);
  const normalize = (s) => (s ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!normalize(profile?.description).includes(normalize(pending.code))) {
    return interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [
        embed(colors.warn).setDescription(
          "I couldn't find the code in your profile's About section yet. Make sure you saved it, wait a few seconds, then press **Done** again.",
        ),
      ],
    });
  }

  const result = await linkAccount(interaction.member, pending);
  const e = verifiedEmbed(pending.username, result);
  e.setDescription(`${e.data.description} You can remove the code from your profile.`);
  return interaction.editReply({ embeds: [e], components: [] });
}

function verifiedEmbed(username, result) {
  const e = embed(colors.ok).setTitle('Verified!').setDescription(`Your Discord account is now linked to **${username}**.`);
  if (result.errors.length) e.addFields({ name: 'Notes', value: result.errors.join('\n') });
  return e;
}
