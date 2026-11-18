import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags, ModalBuilder,
  PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { gameUrl, getGame, getUniverseId } from '../lib/roblox.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { card, colors, divider, footnote, notice, progress, section, text, thumb, v2 } from '../lib/ui.js';
import { ticketPanel, verifyPanel } from './panel.js';
import { DEFAULT_FILTERS, FILTERS } from '../lib/automod.js';
import { AGE_OPTIONS, RAID_LEVELS } from '../lib/raid.js';

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
  { key: 'welcomeChannel', kind: 'channel', section: 'Channels', emoji: '👋', title: 'Welcome channel',
    desc: 'New members are greeted here and told to verify.' },
  { key: 'modLogChannel', kind: 'channel', section: 'Channels', emoji: '🛡️', title: 'Mod log channel',
    desc: 'Every warn, kick, ban and unban is logged here, even ones done from Discord itself, plus AutoMod and raid alerts. Make it staff-only.' },
  { key: 'suggestionsChannel', kind: 'channel', section: 'Channels', emoji: '💡', title: 'Suggestions channel',
    desc: '`/suggest` posts ideas here with 👍/👎 votes.' },
  { key: 'ticketCategory', kind: 'category', section: 'Tickets', emoji: '🎫', title: 'Ticket category',
    desc: 'New ticket channels are created inside this category.' },
  { key: 'ticketLogChannel', kind: 'channel', section: 'Tickets', emoji: '📜', title: 'Ticket log channel',
    desc: 'Transcripts of closed tickets are posted here. Make it staff-only.' },
  { key: 'levelUpChannel', kind: 'channel', section: 'Levels', emoji: '🎉', title: 'Level-up channel',
    desc: 'Level-up messages go here. If you skip this, they show up in whatever channel the person was chatting in.' },
  { key: 'levelRewards', kind: 'rewards', section: 'Levels', emoji: '🎁', title: 'Level rewards',
    desc: 'Give a role when someone reaches a level. Pick a role, then type the level.\nExample: level **5** → @Active, level **20** → @Veteran.' },
  { key: 'streakTimezone', kind: 'timezone', section: 'Levels', emoji: '🕛', title: 'Streak timezone',
    desc: 'Chat streaks count calendar days. Pick where most of your members live, so a "day" ends at their midnight.' },
  { key: 'serverLogChannel', kind: 'channel', section: 'Safety', emoji: '🧾', title: 'Server log channel',
    desc: 'Deleted and edited messages, role and nickname changes, and timeouts are logged here. Make it staff-only.' },
  { key: 'joinLogChannel', kind: 'channel', section: 'Safety', emoji: '📥', title: 'Join log channel',
    desc: 'Everyone who joins is logged here, with how old their account is. If you skip this, joins go to the server log channel.' },
  { key: 'leaveLogChannel', kind: 'channel', section: 'Safety', emoji: '📤', title: 'Leave log channel',
    desc: 'Everyone who leaves is logged here. If you skip this, leaves go to the server log channel.' },
  { key: 'automodFilters', kind: 'multi', section: 'Safety', emoji: '🤖', title: 'AutoMod filters', options: FILTERS, fallback: DEFAULT_FILTERS,
    desc: 'Pick what AutoMod removes. Staff (anyone who can manage messages) are never filtered. Untick everything to turn AutoMod off.' },
  { key: 'bannedWords', kind: 'words', section: 'Safety', emoji: '🤬', title: 'Blocked words',
    desc: 'Words AutoMod deletes (needs the **Blocked words** filter). It also catches simple disguises like b4dw0rd.' },
  { key: 'automodExemptRoles', kind: 'roles', section: 'Safety', emoji: '🛡️', title: 'AutoMod exempt roles',
    desc: 'Optional. Roles AutoMod ignores, like trusted members or content creators. Staff are already exempt.' },
  { key: 'raidProtection', kind: 'choice', section: 'Safety', emoji: '🚨', title: 'Raid protection', options: RAID_LEVELS, fallback: 'normal',
    desc: 'When lots of people join at once, raid mode kicks brand-new accounts (under 30 days) for a few minutes and alerts staff.' },
  { key: 'minAccountAge', kind: 'choice', section: 'Safety', emoji: '👶', title: 'Minimum account age', options: AGE_OPTIONS, fallback: '0',
    desc: 'Kick accounts younger than this when they join (they get a DM explaining why). Stops most alt accounts.' },
];
const optionLabel = (st, v) => st.options.find(([id]) => id === v)?.[1] ?? v;

export const TIMEZONES = [
  ['UTC', 'UTC (world time)'], ['America/Los_Angeles', 'US Pacific (Los Angeles)'], ['America/Denver', 'US Mountain (Denver)'],
  ['America/Chicago', 'US Central (Chicago)'], ['America/New_York', 'US Eastern (New York)'], ['America/Mexico_City', 'Mexico City'],
  ['America/Sao_Paulo', 'Brazil (São Paulo)'], ['America/Argentina/Buenos_Aires', 'Argentina (Buenos Aires)'],
  ['Europe/London', 'UK (London)'], ['Europe/Paris', 'Central Europe (Paris, Berlin)'], ['Europe/Athens', 'Eastern Europe (Athens)'],
  ['Europe/Istanbul', 'Turkey (Istanbul)'], ['Europe/Moscow', 'Russia (Moscow)'], ['Africa/Lagos', 'West Africa (Lagos)'],
  ['Africa/Johannesburg', 'South Africa (Johannesburg)'], ['Asia/Dubai', 'Gulf (Dubai)'], ['Asia/Tehran', 'Iran (Tehran)'],
  ['Asia/Kolkata', 'India'], ['Asia/Jakarta', 'Indonesia (Jakarta)'], ['Asia/Manila', 'Philippines, Singapore, Malaysia'],
  ['Asia/Shanghai', 'China, Hong Kong, Taiwan'], ['Asia/Tokyo', 'Japan, Korea'], ['Australia/Sydney', 'Australia East (Sydney)'],
  ['Pacific/Auckland', 'New Zealand'],
];
const tzLabel = (tz) => TIMEZONES.find(([id]) => id === tz)?.[1] ?? tz;
const OVERVIEW = STEPS.length;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up the bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const settings = await getSettings(interaction.guildId);
  // Start at the summary if they've set things up before, otherwise at step 1.
  const start = Object.keys(settings).length ? OVERVIEW : 0;
  const msg = await render(interaction.guild, start);
  msg.flags |= MessageFlags.Ephemeral;
  return interaction.reply(msg);
}

export async function handleButton(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action, stepStr] = interaction.customId.split(':');
  const step = Number(stepStr);

  if (action === 'go') return interaction.update(await render(interaction.guild, step));
  if (action === 'clear') {
    const { key } = STEPS[step];
    const extra = key === 'placeId' ? { gameName: null } : {};
    await updateSettings(interaction.guildId, { [key]: null, ...extra });
    return interaction.update(await render(interaction.guild, step));
  }
  if (action === 'ask') return interaction.showModal(linkModal(step));
  if (action === 'words') {
    const { bannedWords = [] } = await getSettings(interaction.guildId);
    return interaction.showModal(new ModalBuilder().setCustomId(`setup:wordsave:${step}`).setTitle('Blocked words').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('words').setLabel('Words or phrases, separated by commas')
        .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(3000).setValue(bannedWords.join(', '))
        .setPlaceholder('word one, word two, a phrase')),
    ));
  }
  if (action === 'finish') return interaction.update(finished(await getSettings(interaction.guildId)));
  if (action === 'post') {
    // From the Finish screen: post a panel into the channel /setup was run in.
    const panel = stepStr === 'verify' ? await verifyPanel(interaction.guild) : ticketPanel(interaction.guild);
    if (!panel) return interaction.reply(notice('bad', 'Add ticket types to config.json first.'));
    const sent = await interaction.channel.send(panel).catch(() => null);
    return interaction.reply(sent
      ? notice('ok', `Posted in ${interaction.channel}.`)
      : notice('bad', `I can't post in ${interaction.channel}. Give me access to it, or use \`/panel\` in another channel.`));
  }
}

/** Select menus: role/channel picks and jump-to-step. */
export async function handleSelect(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action, stepStr] = interaction.customId.split(':');
  const step = Number(stepStr);
  const { values } = interaction;

  if (action === 'jump') return interaction.update(await render(interaction.guild, Number(values[0])));

  if (action === 'set') {
    const s = STEPS[step];
    await updateSettings(interaction.guildId, { [s.key]: s.kind === 'roles' || s.kind === 'multi' ? values : values[0] });
    return interaction.update(await render(interaction.guild, step + 1));
  }

  if (action === 'rewardrole') {
    const role = interaction.guild.roles.cache.get(values[0]);
    return interaction.showModal(
      new ModalBuilder().setCustomId(`setup:reward:${step}:${values[0]}`).setTitle(`Level for @${role?.name ?? 'role'}`.slice(0, 45)).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Level needed (1-500)')
          .setStyle(TextInputStyle.Short).setMaxLength(3).setPlaceholder('10')),
      ),
    );
  }

  if (action === 'unreward') {
    const { levelRewards = [] } = await getSettings(interaction.guildId);
    await updateSettings(interaction.guildId, { levelRewards: levelRewards.filter((r) => r.roleId !== values[0]) });
    return interaction.update(await render(interaction.guild, step));
  }
}

export async function handleModal(interaction) {
  if (!allowed(interaction)) return denied(interaction);
  const [, action, stepStr, roleId] = interaction.customId.split(':');
  const step = Number(stepStr);

  if (action === 'wordsave') {
    const words = [...new Set(interaction.fields.getTextInputValue('words').split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 300);
    await updateSettings(interaction.guildId, { bannedWords: words.length ? words : null });
    return interaction.update(await render(interaction.guild, step));
  }

  if (action === 'reward') {
    const level = Number(interaction.fields.getTextInputValue('level').trim());
    if (!Number.isInteger(level) || level < 1 || level > 500) {
      return interaction.update(await render(interaction.guild, step, 'The level must be a whole number from 1 to 500.'));
    }
    const { levelRewards = [] } = await getSettings(interaction.guildId);
    const next = [...levelRewards.filter((r) => r.roleId !== roleId), { roleId, level }].sort((a, b) => a.level - b.level);
    await updateSettings(interaction.guildId, { levelRewards: next });
    return interaction.update(await render(interaction.guild, step));
  }

  if (action === 'link') {
    const input = interaction.fields.getTextInputValue('link').trim();
    await interaction.deferUpdate();
    const placeId = input.match(/games\/(\d+)/)?.[1] ?? input.match(/^\d+$/)?.[0];
    const universeId = placeId && (await getUniverseId(placeId).catch(() => null));
    const game = universeId && (await getGame(universeId).catch(() => null));
    if (!game) return interaction.editReply(await render(interaction.guild, step, "Couldn't find that game. Paste the full link from your browser, e.g. `https://www.roblox.com/games/123456/My-Game`."));
    await updateSettings(interaction.guildId, { placeId, gameName: game.name });
    return interaction.editReply(await render(interaction.guild, step + 1));
  }
}

// ---------------------------------------------------------------- rendering

const allowed = (i) => i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
const denied = (i) => i.reply(notice('bad', 'You need the **Manage Server** permission to change the setup.'));
const SECTION_COLORS = { Roles: colors.brand, Roblox: colors.roblox, Channels: colors.info, Tickets: colors.ticket, Levels: colors.ok, Safety: colors.bad };
const SECTION_ICONS = { Roles: '🎭', Roblox: '🎮', Channels: '📡', Tickets: '🎫', Levels: '⭐', Safety: '🛡️' };

function linkModal(step) {
  return new ModalBuilder().setCustomId(`setup:link:${step}`).setTitle('Roblox game').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('link').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)
        .setLabel('Game link (or place ID)')
        .setPlaceholder('https://www.roblox.com/games/123456/...'),
    ),
  );
}

/** How a saved value looks, or null if not set. */
function show(step, s) {
  const v = s[step.key];
  if (step.kind === 'multi' && Array.isArray(v)) return v.length ? v.map((id) => optionLabel(step, id)).join(', ') : 'All off';
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return null;
  switch (step.kind) {
    case 'role': return `<@&${v}>`;
    case 'roles': return v.map((id) => `<@&${id}>`).join(' ');
    case 'channel':
    case 'category': return `<#${v}>`;
    case 'game': return `[${s.gameName ?? v}](${gameUrl(v)})`;
    case 'timezone': return tzLabel(v);
    case 'choice': return optionLabel(step, v);
    case 'words': return `${v.length} word${v.length === 1 ? '' : 's'} · ||${v.slice(0, 8).join(', ')}${v.length > 8 ? ', …' : ''}||`;
    case 'rewards': return v.map((r) => `Level **${r.level}** → <@&${r.roleId}>`).join(', ');
    default: return String(v);
  }
}

function navRow(step, { canClear }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:go:${step - 1}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(step === 0),
    // On the last step, Next goes to the summary page (which has the Finish button).
    new ButtonBuilder().setCustomId(`setup:go:${step + 1}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`setup:clear:${step}`).setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Secondary).setDisabled(!canClear),
  );
}

export async function render(guild, step, error) {
  const s = await getSettings(guild.id);
  if (step >= OVERVIEW) return overview(guild, s);
  step = Math.max(0, step);

  const st = STEPS[step];
  const current = show(st, s);

  let picker;
  if (st.kind === 'role' || st.kind === 'roles') {
    const menu = new RoleSelectMenuBuilder().setCustomId(`setup:set:${step}`)
      .setPlaceholder(st.kind === 'roles' ? 'Select the roles…' : `Select the ${st.title.toLowerCase()}…`);
    if (st.kind === 'roles') menu.setMinValues(1).setMaxValues(10);
    const ids = [].concat(s[st.key] ?? []).filter((id) => guild.roles.cache.has(id));
    if (ids.length) menu.setDefaultRoles(ids);
    picker = new ActionRowBuilder().addComponents(menu);
  } else if (st.kind === 'channel' || st.kind === 'category') {
    const menu = new ChannelSelectMenuBuilder().setCustomId(`setup:set:${step}`)
      .setChannelTypes(st.kind === 'category' ? [ChannelType.GuildCategory] : TEXT_CHANNELS)
      .setPlaceholder(`Select the ${st.title.toLowerCase()}…`);
    if (s[st.key] && guild.channels.cache.has(s[st.key])) menu.setDefaultChannels(s[st.key]);
    picker = new ActionRowBuilder().addComponents(menu);
  } else if (st.kind === 'multi' || st.kind === 'choice') {
    const selected = [].concat(s[st.key] ?? st.fallback);
    const menu = new StringSelectMenuBuilder().setCustomId(`setup:set:${step}`)
      .setPlaceholder(st.kind === 'multi' ? 'Tick what you want on…' : 'Choose one…')
      .addOptions(st.options.map(([id, label, description]) => ({
        label, value: id, default: selected.includes(id), ...(description ? { description: description.slice(0, 100) } : {}),
      })));
    if (st.kind === 'multi') menu.setMinValues(0).setMaxValues(st.options.length);
    picker = new ActionRowBuilder().addComponents(menu);
  } else if (st.kind === 'words') {
    picker = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:words:${step}`).setStyle(ButtonStyle.Success).setEmoji('✏️')
        .setLabel(s.bannedWords?.length ? 'Edit the list' : 'Add words'),
    );
  } else if (st.kind === 'timezone') {
    picker = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`setup:set:${step}`).setPlaceholder('Select a timezone…').addOptions(
        TIMEZONES.map(([id, label]) => ({ label, value: id, default: id === s.streakTimezone })),
      ),
    );
  } else if (st.kind === 'rewards') {
    const rewards = s.levelRewards ?? [];
    picker = [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`setup:rewardrole:${step}`).setPlaceholder('➕ Add: pick a role, then type its level…'),
      ),
      rewards.length
        ? new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`setup:unreward:${step}`).setPlaceholder('➖ Remove one…').addOptions(
            rewards.slice(0, 25).map((r) => ({
              label: `Level ${r.level} → @${guild.roles.cache.get(r.roleId)?.name ?? 'deleted role'}`.slice(0, 100), value: r.roleId,
            })),
          ),
        )
        : null,
    ];
  } else if (st.kind === 'game') {
    picker = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:ask:${step}`).setStyle(ButtonStyle.Success).setEmoji('🔗')
        .setLabel(current ? 'Change game' : 'Paste game link'),
    );
  }

  return v2(card(SECTION_COLORS[st.section] ?? colors.brand,
    text(`-# ⚙️ SETUP · ${st.section.toUpperCase()} · STEP ${step + 1} OF ${STEPS.length}`, progress(step + 1, STEPS.length)),
    divider(),
    text(`## ${st.emoji} ${st.title}`, st.desc),
    divider({ line: false }),
    text(`**Current** · ${current ? `✅ ${current}`
      : st.kind === 'timezone' ? '➖ Not set · using UTC'
        : st.fallback !== undefined ? `➖ Not set · using the default: ${[].concat(st.fallback).map((v) => optionLabel(st, v)).join(', ')}`
          : '➖ Not set'}`),
    error ? text(`❌ ${error}`) : null,
    divider(),
    picker,
    navRow(step, { canClear: Boolean(current) }),
    footnote(st.kind === 'game' ? 'We check the link with Roblox before saving'
      : st.kind === 'multi' ? 'Tick or untick, then click outside the menu to save'
      : st.kind === 'words' ? 'Only staff can see this list'
      : st.kind === 'rewards' ? 'Add as many as you like, then press Next'
        : 'Pick below · it saves instantly and moves to the next step'),
  ));
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
    ...(s.serverLogChannel && { ViewAuditLog: 'show who kicked, banned or changed roles in the logs' }),
  };
  const missing = Object.entries(needed).filter(([p]) => !me.permissions.has(PermissionFlagsBits[p])).map(([, what]) => what);
  if (missing.length) out.push(`⚠️ The bot's role is missing permissions to **${missing.join(', ')}**.`);

  const handedOut = [s.verifiedRole, s.unverifiedRole, ...(s.levelRewards ?? []).map((r) => r.roleId)].filter(Boolean);
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

  if (!s.verifiedRole) out.push('💡 No **Verified role** yet: people can verify, but won\'t get a role.');
  if (s.ticketCategory && !s.ticketLogChannel) out.push('💡 No **ticket log channel**: closed-ticket transcripts will only be DMed to the member.');
  return out;
}

async function overview(guild, s) {
  const sections = {};
  for (const st of STEPS) {
    const v = show(st, s);
    (sections[st.section] ??= []).push(v ? `✅ **${st.title}** · ${v}` : `➖ **${st.title}** · *not set*`);
  }
  const done = STEPS.filter((st) => show(st, s)).length;
  const problems = checks(guild, s);
  const blocking = problems.filter((p) => p.startsWith('⚠️')).length;

  const summary = card(colors.brand,
    section([
      '-# ⚙️ SETUP · SUMMARY',
      `## ${guild.name}`,
      `${progress(done, STEPS.length)}  **${done}/${STEPS.length}** set`,
    ], thumb(guild.iconURL({ size: 128 }))),
    Object.entries(sections).map(([name, lines]) => [divider(), text(`### ${SECTION_ICONS[name] ?? '•'} ${name}`, lines)]),
    divider(),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('setup:jump').setPlaceholder('✏️ Change something…').addOptions(
        STEPS.map((st, i) => ({ label: st.title, description: st.section, value: String(i), emoji: st.emoji })),
      ),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:go:${OVERVIEW - 1}`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:finish').setLabel('Finish').setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
  );
  const health = card(blocking ? colors.warn : colors.ok,
    text(
      blocking ? `### 🔍 ${blocking} thing${blocking === 1 ? '' : 's'} to fix` : '### 🔍 Checks',
      problems.length ? problems : ['✅ Everything looks good! The bot has all the access it needs.'],
    ),
  );
  return v2([summary, health]);
}

function finished(s) {
  return v2(card(colors.ok,
    text('## 🎉 You\'re all set!', 'Your settings are saved. Last step: post the buttons members will click.'),
    divider(),
    section(['**🔐 Verify panel**', '-# Post it in the channel where people should verify'],
      new ButtonBuilder().setCustomId('setup:post:verify').setLabel('Post here').setStyle(ButtonStyle.Primary)),
    s.ticketCategory
      ? section(['**🎫 Ticket panel**', '-# Post it in your support channel'],
        new ButtonBuilder().setCustomId('setup:post:tickets').setLabel('Post here').setStyle(ButtonStyle.Primary))
      : null,
    divider(),
    footnote('Tip: run this from the right channel, or use /panel later · /setup again any time to change things'),
  ));
}
