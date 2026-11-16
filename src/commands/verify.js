import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { randomInt } from 'node:crypto';
import { getUser, getUserByUsername, profileUrl } from '../lib/roblox.js';
import { db } from '../lib/store.js';
import { syncMember } from '../lib/roles.js';
import { colors, embed } from '../lib/ui.js';

const CODE_TTL_MS = 15 * 60_000;
// Plain words survive Roblox's chat filter better than random letters/numbers.
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
    o.setName('username').setDescription('Your Roblox username').setRequired(true).setMaxLength(20),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await getUserByUsername(interaction.options.getString('username', true));
  if (!user) {
    return interaction.editReply({ embeds: [embed(colors.bad).setDescription('No Roblox user has that username.')] });
  }

  const existing = db.data.links[interaction.user.id];
  if (existing?.robloxId === user.id) {
    return interaction.editReply({
      embeds: [embed(colors.ok).setDescription(`You're already linked to **${user.name}**. Use \`/update\` to refresh your roles.`)],
    });
  }

  const code = makeCode();
  db.data.pending[interaction.user.id] = { robloxId: user.id, username: user.name, code, expiresAt: Date.now() + CODE_TTL_MS };
  db.save();

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

export async function handleButton(interaction) {
  const pending = db.data.pending[interaction.user.id];
  if (!pending || pending.expiresAt < Date.now()) {
    delete db.data.pending[interaction.user.id];
    db.save();
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

  db.data.links[interaction.user.id] = { robloxId: pending.robloxId, username: pending.username, linkedAt: Date.now() };
  delete db.data.pending[interaction.user.id];
  db.save();

  const result = await syncMember(interaction.member);
  const e = embed(colors.ok)
    .setTitle('Verified!')
    .setDescription(`Your Discord account is now linked to **${pending.username}**. You can remove the code from your profile.`);
  if (result.errors.length) e.addFields({ name: 'Notes', value: result.errors.join('\n') });
  return interaction.editReply({ embeds: [e], components: [] });
}
