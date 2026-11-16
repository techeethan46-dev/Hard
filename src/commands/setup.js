import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags, ModalBuilder,
  PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { gameUrl, getGame, getGroup, getUniverseId, groupUrl } from '../lib/roblox.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { colors, embed } from '../lib/ui.js';

// Step-by-step setup inside Discord. Every pick saves instantly and moves on to the next step.
// customIds: setup:<action>:<step>[:extra]

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const STEPS = [
  { key: 'verifiedRole', kind: 'role', section: 'Roles', emoji: '✅', title: 'Verified role',
    desc: 'Given to everyone who links their Roblox account.' },
  { key: 'unverifiedRole', kind: 'role', section: 'Roles', emoji: '🔒', title: 'Unverified role',
    desc: 'Optional. Given to new members until they verify. Use it to hide channels from people who haven\'t verified.' },
  { key: 'supportRoles', kind: 'roles', section: 'Roles', emoji: '🛟', title: 'Support staff roles',
    desc: 'Can see and answer tickets. Members with **Manage Server** always can. You can pick several.' },
  { key: 'placeId', kind: 'game', section: 'Roblox', emoji: '🎮', title: 'Roblox game',
    desc: 'Powers `/game` and the live player count in the bot\'s status. Paste the game\'s link.' },
  { key: 'groupId', kind: 'group', section: 'Roblox', emoji: '👥', title: 'Roblox group',
    desc: 'Used for group rank roles and `/whois`. Paste the group\'s link.' },
  { key: 'rankBindings', kind: 'bindings', section: 'Roblox', emoji: '🏅', title: 'Group rank roles',
    desc: 'Give Discord roles based on Roblox group rank. Pick a role, then type which ranks get it (0–255).\nExample: ranks **1–254** → @Member, ranks **200–254** → @Staff.' },
  { key: 'welcomeChannel', kind: 'channel', section: 'Channels', emoji: '👋', title: 'Welcome channel',
    desc: 'New members are greeted here and told to verify.' },
  { key: 'modLogChannel', kind: 'channel', section: 'Channels', emoji: '🛡️', title: 'Mod log channel',
    desc: 'Every warn, timeout, kick and ban is logged here. Make it staff-only.' },
  { key: 'suggestionsChannel', kind: 'channel', section: 'Channels', emoji: '💡', title: 'Suggestions channel',
    desc: '`/suggest` posts ideas here with 👍/👎 votes.' },
  { key: 'ticketCategory', kind: 'category', section: 'Tickets', emoji: '🎫', title: 'Ticket category',
    desc: 'New ticket channels are created inside this category.' },
  { key: 'ticketLogChannel', kind: 'channel', section: 'Tickets', emoji: '📜', title: 'Ticket log channel',
    desc: 'Transcripts of closed tickets are posted here. Make it staff-only.' },
];
const OVERVIEW = STEPS.length;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up the bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const settings = await getSettings(interaction.guildId);
  // Start at the overview if they've set things up before, otherwise at step 1.
  const start = Object.keys(settings).length ? OVERVIEW : 0;
  return interaction.reply({ flags: MessageFlags.Ephemeral, ...(await render(interaction.guild, start)) });
}

export async function handleButton(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action, stepStr] = interaction.customId.split(':');
  const step = Number(stepStr);

  if (action === 'go') return interaction.update(await render(interaction.guild, step));
  if (action === 'clear') {
    const { key } = STEPS[step];
    const extra = key === 'placeId' ? { gameName: null } : key === 'groupId' ? { groupName: null } : {};
    await updateSettings(interaction.guildId, { [key]: null, ...extra });
    return interaction.update(await render(interaction.guild, step));
  }
  if (action === 'ask') return interaction.showModal(linkModal(step));
  if (action === 'finish') return interaction.update(finished(await getSettings(interaction.guildId)));
}

/** Select menus: role/channel picks, jump-to-step, rank bindings. */
export async function handleSelect(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action, stepStr] = interaction.customId.split(':');
  const step = Number(stepStr);
  const { values } = interaction;

  if (action === 'jump') return interaction.update(await render(interaction.guild, Number(values[0])));

  if (action === 'set') {
    const s = STEPS[step];
    await updateSettings(interaction.guildId, { [s.key]: s.kind === 'roles' ? values : values[0] });
    return interaction.update(await render(interaction.guild, step + 1));
  }

  if (action === 'bindrole') {
    const role = interaction.guild.roles.cache.get(values[0]);
    return interaction.showModal(
      new ModalBuilder().setCustomId(`setup:bind:${step}:${values[0]}`).setTitle(`Ranks for @${role?.name ?? 'role'}`.slice(0, 45)).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min').setLabel('Lowest rank (0-255)')
          .setStyle(TextInputStyle.Short).setMaxLength(3).setValue('1')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max').setLabel('Highest rank (0-255)')
          .setStyle(TextInputStyle.Short).setMaxLength(3).setValue('255')),
      ),
    );
  }

  if (action === 'unbind') {
    const { rankBindings = [] } = await getSettings(interaction.guildId);
    await updateSettings(interaction.guildId, { rankBindings: rankBindings.filter((_, i) => String(i) !== values[0]) });
    return interaction.update(await render(interaction.guild, step));
  }
}

export async function handleModal(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action, stepStr, roleId] = interaction.customId.split(':');
  const step = Number(stepStr);

  if (action === 'bind') {
    const min = Number(interaction.fields.getTextInputValue('min'));
    const max = Number(interaction.fields.getTextInputValue('max'));
    if (![min, max].every((n) => Number.isInteger(n) && n >= 0 && n <= 255) || min > max) {
      return interaction.update(await render(interaction.guild, step, 'Ranks must be whole numbers from 0 to 255, lowest first.'));
    }
    const { rankBindings = [] } = await getSettings(interaction.guildId);
    const next = [...rankBindings.filter((b) => b.roleId !== roleId), { roleId, minRank: min, maxRank: max }]
      .sort((a, b) => a.minRank - b.minRank);
    await updateSettings(interaction.guildId, { rankBindings: next });
    return interaction.update(await render(interaction.guild, step));
  }

  if (action === 'link') {
    const input = interaction.fields.getTextInputValue('link').trim();
    const { kind } = STEPS[step];
    await interaction.deferUpdate();

    if (kind === 'game') {
      const placeId = input.match(/games\/(\d+)/)?.[1] ?? input.match(/^\d+$/)?.[0];
      const universeId = placeId && (await getUniverseId(placeId).catch(() => null));
      const game = universeId && (await getGame(universeId).catch(() => null));
      if (!game) return interaction.editReply(await render(interaction.guild, step, "Couldn't find that game. Paste the full link from your browser, e.g. `https://www.roblox.com/games/123456/My-Game`."));
      await updateSettings(interaction.guildId, { placeId, gameName: game.name });
    } else {
      const groupId = input.match(/(?:groups|communities)\/(\d+)/)?.[1] ?? input.match(/^\d+$/)?.[0];
      const group = groupId && (await getGroup(groupId));
      if (!group?.name) return interaction.editReply(await render(interaction.guild, step, "Couldn't find that group. Paste the full link, e.g. `https://www.roblox.com/communities/123456/My-Group`."));
      await updateSettings(interaction.guildId, { groupId, groupName: group.name });
    }
    return interaction.editReply(await render(interaction.guild, step + 1));
  }
}

// ---------------------------------------------------------------- rendering

const allowed = (i) => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
const denied = (i) => i.reply({ flags: MessageFlags.Ephemeral, content: 'You need **Manage Server** to change the setup.' });
const bar = (done) => '▰'.repeat(done) + '▱'.repeat(STEPS.length - done);

function linkModal(step) {
  const { kind } = STEPS[step];
  return new ModalBuilder().setCustomId(`setup:link:${step}`).setTitle(kind === 'game' ? 'Roblox game' : 'Roblox group').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('link').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)
        .setLabel(kind === 'game' ? 'Game link (or place ID)' : 'Group link (or group ID)')
        .setPlaceholder(kind === 'game' ? 'https://www.roblox.com/games/123456/...' : 'https://www.roblox.com/communities/123456/...'),
    ),
  );
}

/** How a saved value looks, or null if not set. */
function show(step, s) {
  const v = s[step.key];
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return null;
  switch (step.kind) {
    case 'role': return `<@&${v}>`;
    case 'roles': return v.map((id) => `<@&${id}>`).join(' ');
    case 'channel':
    case 'category': return `<#${v}>`;
    case 'game': return `[${s.gameName ?? v}](${gameUrl(v)})`;
    case 'group': return `[${s.groupName ?? v}](${groupUrl(v)})`;
    case 'bindings': return v.map((b) => `Ranks **${b.minRank}–${b.maxRank}** → <@&${b.roleId}>`).join('\n');
    default: return String(v);
  }
}

function navRow(step, { canClear }) {
  const last = step === OVERVIEW - 1;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:go:${step - 1}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(step === 0),
    new ButtonBuilder().setCustomId(`setup:go:${step + 1}`).setLabel(last ? 'Overview' : 'Next').setEmoji('▶️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:clear:${step}`).setLabel('Clear').setStyle(ButtonStyle.Secondary).setDisabled(!canClear),
  );
  // Button IDs must be unique per message, so skip this on the last step (Next already goes to the overview).
  if (!last) row.addComponents(new ButtonBuilder().setCustomId(`setup:go:${OVERVIEW}`).setLabel('Overview').setStyle(ButtonStyle.Secondary));
  return row;
}

export async function render(guild, step, error) {
  const s = await getSettings(guild.id);
  if (step >= OVERVIEW) return overview(guild, s);
  step = Math.max(0, step);

  const st = STEPS[step];
  const current = show(st, s);
  const e = embed()
    .setTitle(`⚙️ Setup · Step ${step + 1} of ${STEPS.length}`)
    .setDescription([
      bar(step + 1),
      '',
      `## ${st.emoji} ${st.title}`,
      st.desc,
      '',
      st.kind === 'bindings' ? `**Current:**\n${current ?? '➖ None yet'}` : `**Current:** ${current ? `✅ ${current}` : '➖ Not set'}`,
      st.kind === 'bindings' && !s.groupId ? '\n⚠️ Set the **Roblox group** step first, or these won\'t do anything.' : '',
      error ? `\n❌ ${error}` : '',
    ].join('\n'))
    .setFooter({ text: st.kind === 'bindings' ? 'Add as many as you need, then press Next' : 'Pick below · it saves instantly and moves to the next step' });

  const rows = [];
  if (st.kind === 'role' || st.kind === 'roles') {
    const menu = new RoleSelectMenuBuilder().setCustomId(`setup:set:${step}`)
      .setPlaceholder(st.kind === 'roles' ? 'Select the roles…' : `Select the ${st.title.toLowerCase()}…`);
    if (st.kind === 'roles') menu.setMinValues(1).setMaxValues(10);
    const ids = [].concat(s[st.key] ?? []).filter((id) => guild.roles.cache.has(id));
    if (ids.length) menu.setDefaultRoles(ids);
    rows.push(new ActionRowBuilder().addComponents(menu));
  } else if (st.kind === 'channel' || st.kind === 'category') {
    const menu = new ChannelSelectMenuBuilder().setCustomId(`setup:set:${step}`)
      .setChannelTypes(st.kind === 'category' ? [ChannelType.GuildCategory] : TEXT_CHANNELS)
      .setPlaceholder(`Select the ${st.title.toLowerCase()}…`);
    if (s[st.key] && guild.channels.cache.has(s[st.key])) menu.setDefaultChannels(s[st.key]);
    rows.push(new ActionRowBuilder().addComponents(menu));
  } else if (st.kind === 'game' || st.kind === 'group') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:ask:${step}`).setStyle(ButtonStyle.Success).setEmoji('🔗')
        .setLabel(current ? `Change ${st.kind}` : `Set ${st.kind}`),
    ));
  } else if (st.kind === 'bindings') {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(`setup:bindrole:${step}`).setPlaceholder('Add: pick a role, then enter its ranks…'),
    ));
    const bindings = s.rankBindings ?? [];
    if (bindings.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`setup:unbind:${step}`).setPlaceholder('Remove one…').addOptions(
          bindings.slice(0, 25).map((b, i) => ({
            label: `Ranks ${b.minRank}–${b.maxRank} → @${guild.roles.cache.get(b.roleId)?.name ?? 'deleted role'}`.slice(0, 100),
            value: String(i),
          })),
        ),
      ));
    }
  }
  rows.push(navRow(step, { canClear: Boolean(current) }));
  return { embeds: [e], components: rows };
}

/** Problems that would stop features from working, in plain words. */
export function checks(guild, s) {
  const out = [];
  const me = guild.members.me;
  const top = me.roles.highest.position;

  const needed = {
    ManageRoles: 'give roles', ManageNicknames: 'set nicknames', KickMembers: 'kick', BanMembers: 'ban',
    ModerateMembers: 'time out', ManageMessages: 'purge messages',
    ...(s.ticketCategory && { ManageChannels: 'create ticket channels' }),
  };
  const missing = Object.entries(needed).filter(([p]) => !me.permissions.has(PermissionFlagsBits[p])).map(([, what]) => what);
  if (missing.length) out.push(`⚠️ The bot's role is missing permissions to **${missing.join(', ')}**.`);

  const handedOut = [s.verifiedRole, s.unverifiedRole, ...(s.rankBindings ?? []).map((b) => b.roleId)].filter(Boolean);
  for (const id of new Set(handedOut)) {
    const role = guild.roles.cache.get(id);
    if (!role) out.push(`⚠️ A role you picked was deleted. Pick it again.`);
    else if (role.position >= top) out.push(`⚠️ Drag the bot's role **above** <@&${id}> (Server Settings → Roles), or it can't give it.`);
  }

  for (const st of STEPS.filter((x) => x.kind === 'channel' || x.kind === 'category')) {
    const id = s[st.key];
    if (!id) continue;
    const ch = guild.channels.cache.get(id);
    if (!ch) { out.push(`⚠️ The **${st.title}** was deleted. Pick it again.`); continue; }
    const perms = ch.permissionsFor(me);
    const need = st.kind === 'category'
      ? ['ViewChannel', 'ManageChannels', 'SendMessages']
      : ['ViewChannel', 'SendMessages', 'EmbedLinks', ...(st.key === 'ticketLogChannel' ? ['AttachFiles'] : [])];
    if (!need.every((p) => perms?.has(PermissionFlagsBits[p]))) out.push(`⚠️ The bot can't post in <#${id}>. Give it access to that ${st.kind}.`);
  }

  if (s.rankBindings?.length && !s.groupId) out.push('⚠️ Group rank roles are set, but no **Roblox group** is.');
  if (!s.verifiedRole) out.push('💡 No **Verified role** yet: people can verify, but won\'t get a role.');
  if (s.ticketCategory && !s.ticketLogChannel) out.push('💡 No **ticket log channel**: closed-ticket transcripts will only be DMed to the member.');
  return out;
}

async function overview(guild, s) {
  const sections = {};
  for (const st of STEPS) {
    const v = show(st, s);
    const line = st.kind === 'bindings' && v
      ? `${st.emoji} ${st.title}\n${v.split('\n').map((l) => `-# ${l}`).join('\n')}`
      : `${st.emoji} ${st.title} · ${v ? `✅ ${v}` : '➖'}`;
    (sections[st.section] ??= []).push(line);
  }
  const problems = checks(guild, s);
  const e = embed()
    .setTitle('⚙️ Setup · Overview')
    .setDescription([
      bar(STEPS.length),
      ...Object.entries(sections).map(([name, lines]) => `\n### ${name}\n${lines.join('\n')}`),
      `\n### 🔍 Checks\n${problems.length ? problems.join('\n') : '✅ Everything looks good!'}`,
    ].join('\n').slice(0, 4096))
    .setFooter({ text: 'Jump to any step with the menu · press Finish when you\'re done' });

  return {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('setup:jump').setPlaceholder('Jump to a step…').addOptions(
          STEPS.map((st, i) => ({ label: `${i + 1}. ${st.title}`, value: String(i), emoji: st.emoji })),
        ),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup:go:${OVERVIEW - 1}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('setup:finish').setLabel('Finish').setEmoji('✅').setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

function finished(s) {
  const next = ['Run `/panel verify` in the channel where people should verify.'];
  if (s.ticketCategory) next.push('Run `/panel tickets` in your support channel.');
  next.push('Run `/setup` again any time to change something.');
  return {
    embeds: [embed(colors.ok).setTitle('✅ Setup saved').setDescription(`**Next:**\n${next.map((n) => `• ${n}`).join('\n')}`)],
    components: [],
  };
}
