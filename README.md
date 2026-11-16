# Roblox Community Bot

A Discord bot for a Roblox game community: Roblox verification, levels, daily chat streaks, tickets, game stats,
suggestions and moderation. Built with [discord.js](https://discord.js.org) v14 and MongoDB, ready for Render.

Everything server-specific (roles, channels, the game) is set **inside Discord with `/setup`**.
No IDs to copy.

## Getting it running

You only need **3 values**: the bot token, the Application ID, and the MongoDB link.

1. **Create the bot** at <https://discord.com/developers/applications> → *New Application*.
   - *Bot* tab: **Reset Token** and copy it. Turn on **Server Members Intent** and **Message Content Intent**.
   - *General Information*: copy the **Application ID**.
   - *OAuth2 → URL Generator*: tick `bot` and `applications.commands`, then the permissions **Manage Roles,
     Manage Channels, Manage Nicknames, Kick Members, Ban Members, Moderate Members, Manage Messages, View Channels,
     Send Messages, Embed Links, Attach Files, Add Reactions, Create Public Threads, Read Message History**.
     Open the link and add the bot to the server. Someone with *Manage Server* on that server has to do this.
2. **MongoDB Atlas**: copy the connection string (*Database → Connect → Drivers*). Under *Network Access*, allow
   `0.0.0.0/0` (or Render's outbound IPs).
3. **Render**: *New → Blueprint* → pick this repo. Paste `DISCORD_TOKEN`, `CLIENT_ID` and `MONGODB_URI` when
   asked; leave the Roblox OAuth ones empty for now. Use the **Starter** plan: the free plan sleeps after 15 minutes
   and takes the bot offline.
4. When the logs say `Logged in as ...`, go to Discord and run **`/setup`**.

Slash commands are registered automatically on each deploy. New global commands can take a few minutes to
appear the first time.

## `/setup`

An admin (needs *Manage Server*) runs `/setup` and goes through the steps with **Back / Next / Clear**.
Every pick saves instantly. After the last step, a summary page shows everything with a **Finish** button.

| Step | What it does |
|---|---|
| ✅ Verified role | Given to everyone who links their Roblox account |
| 🔒 Unverified role | Optional: given until they verify |
| 🛟 Support staff roles | Can see and answer tickets |
| 🎮 Roblox game | Paste the game link: powers `/game` and the live player count |
| 👋 Welcome channel | New members are greeted here |
| 🛡️ Mod log channel | Every warn/timeout/kick/ban is logged |
| 💡 Suggestions channel | Where `/suggest` posts |
| 🎫 Ticket category | Where ticket channels are created |
| 📜 Ticket log channel | Transcripts of closed tickets |
| 🎉 Level-up channel | Where level-up messages go (otherwise the channel they chatted in) |
| 🎁 Level rewards | Pick a role and the level that unlocks it |
| 🕛 Streak timezone | When a "day" ends for chat streaks (default UTC) |
| 🧾 Server log channel | Message deletes/edits, joins/leaves, role/nickname changes, bans |
| 🤖 AutoMod filters | Which rules are on (spam, invites, scams, mass mentions, blocked words, links, caps) |
| 🤬 Blocked words | Your list of words AutoMod removes |
| 🛡️ AutoMod exempt roles | Roles AutoMod ignores (staff are always exempt) |
| 🚨 Raid protection | Off / Normal / Strict |
| 👶 Minimum account age | Kick accounts younger than this when they join |

The summary page also runs checks and tells you what to fix in plain words, like "drag the bot's role above
@Verified" or "the bot can't post in #mod-log".

After setup: run `/panel verify` in your verify channel and `/panel tickets` in your support channel.
Skip any step you don't need; that feature just stays off.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/verify` or the **Verify** button | Everyone | Links a Roblox account (see below) |
| `/update [member]` | Everyone (staff for others) | Re-syncs roles and nickname, e.g. after a promotion |
| `/unverify` | Everyone | Unlinks your Roblox account |
| `/whois [member] [username]` | Everyone | Roblox profile and linked Discord account |
| `/game` | Everyone | Players online, visits, favorites, last update, Play button |
| `/rank [member]` | Everyone | Level, XP progress, server position, streak and restores |
| `/leaderboard` | Everyone | Top 10 by level or by streak (buttons to switch) |
| `/streak` | Everyone | Your streak, restores left, and a Restore button when it broke |
| `/xp set-level/give/reset` | Admins | Adjust someone's level, XP or streak |
| `/raidmode on/off/status` | Admins | Turn raid mode on or off by hand |
| `/giveaway start/end/reroll/cancel/list` | Admins | Giveaways with requirements and bonus entries |
| `/roles create` | Admins | Build a self-role panel (buttons or dropdown, many or only-one) and post it |
| `/sticky set/remove/list` | Moderators | Keep a message at the bottom of a channel |
| `r!afk [reason]` | Everyone | Go AFK, e.g. `r!afk Too tired` |
| `/suggest idea` | Everyone | Posts an idea with 👍/👎 and a discussion thread |
| Ticket buttons, `/ticket close` | Everyone | Opens a private support channel |
| `/ticket add/remove member` | Support staff | Brings someone into a ticket |
| `/warn`, `/warnings list/remove/clear` | Moderators | Warnings, per server |
| `/timeout`, `/kick`, `/ban add/remove`, `/purge` | Moderators | Moderation, logged and DMed to the member |
| `/setup`, `/panel verify`, `/panel tickets` | Admins | Setup and button panels |

Moderation commands are hidden from members without the matching permission.

## Levels and streaks

**Levels:** every message earns 15–25 XP, at most once a minute (so spamming doesn't help). Going from level L to
L+1 takes 5L² + 50L + 100 XP. Level-ups are announced with a card, and reward roles from `/setup` are given
automatically.

**Streaks:** chat at least once a day and your nickname shows it: `Superman [1🔥]`, `Superman [2🔥]`, ...
- Miss a whole day and the streak ends (the badge comes off). The next time you chat, the bot replies with a
  **Restore** button that disappears after a minute. `/streak` shows it too.
- Restoring costs **1 restore per missed day** and adds your old streak back on top of the new one.
- Everyone gets **3 restores per calendar month**.
- Days follow the timezone chosen in `/setup`.
- The bot can't rename the server owner or anyone whose role is above the bot's, so they won't get a badge.

## Giveaways

`/giveaway start prize:"1,000 Robux" duration:1d winners:2` posts a gold giveaway card with the prize, a live
countdown, the winner count, an entry counter and an **Enter giveaway** button. Optional:
- `required_role`, `min_level`, `must_verify`: who can enter (people who can't are told exactly why)
- `bonus_role`: that role gets 2× entries (e.g. Server Booster)
- `description`, `channel`

Durations: `30m`, `2h`, `1d`, `1w`, `1d12h` (1 minute to 30 days). When time's up the card turns into a winners card,
a 🎊 congratulations message pings the winners, and each winner gets a DM. Winners are re-checked when drawn
(still in the server, still meet the requirements). `end`, `reroll` and `cancel` let you pick the giveaway from a list
as you type. Giveaways are saved in MongoDB, so they still end on time after a restart.

## Self-roles, sticky messages and AFK

**Self-roles:** `/roles create` opens a private builder. Pick up to 25 roles, choose **pick as many as they like** or
**only one at a time** (picking one removes the others, good for regions or colors), choose **buttons** or a
**dropdown**, edit the title and text, then press **Post here**. Roles with moderator/admin permissions, bot roles,
and roles above the bot's role are blocked automatically. A role's emoji (if it has one) shows on its button.

**Sticky messages:** `/sticky set` in a channel. The bot reposts it at the bottom a few seconds after chat goes
quiet (at most every 15 seconds in a busy channel) and deletes the old copy, so there's only ever one.

**AFK:** type `r!afk Too tired`. Your name becomes `[AFK] Superman` (the 🔥 streak badge stays). Anyone who pings
you or replies to you gets "💤 Superman is AFK: Too tired · 2 hours ago" (once a minute per channel). Send any
message to come back: you get a welcome-back card listing who pinged you, with jump links.

## AutoMod, raid protection and logs

**AutoMod** deletes rule-breaking messages, shows the member a short warning that disappears, and logs it to the
mod log. Spam gets an instant 5-minute timeout; for other rules, the 3rd hit within 10 minutes means a 10-minute
timeout. Anyone who can manage messages is never filtered. Filters:
- **Spam**: 6+ messages in 6 seconds, or the same message 3 times in 30 seconds (the whole burst is removed)
- **Discord invites**, **scam links** (fake Nitro/Robux bait and look-alike Discord/Roblox/Steam sites like
  `dlscord.gift` or `roblox.com.ge`), **mass mentions** (5+), **blocked words** (catches `b4dw0rd`-style tricks)
- Off by default: **all links**, **excessive caps**

**Raid protection**: if 10 people (5 on Strict) join within 30 seconds, raid mode turns on. Accounts younger
than 30 days are kicked with a polite DM, staff get an alert with an **End raid mode** button, and it switches
off by itself after 10 quiet minutes. `/raidmode` turns it on or off by hand. Separately, **Minimum account age**
kicks very new accounts at any time.

**Server logs** go to the Server log channel: deleted messages (with text and file names), edits (before/after
with a jump button), bulk deletes (as a text file), joins (flags accounts under 7 days), leaves (with their roles),
nickname changes (the 🔥 streak badge is ignored), role changes, timeouts, bans and unbans.

These need **Message Content Intent** turned on in the Developer Portal (Bot tab).

## Verification

- **Profile code** (default): the member types their username, pastes a 6-word code into their Roblox
  profile's *About*, and clicks **Done**. Works with no extra setup.
- **Sign in with Roblox** (optional, easier for members): one click and approve on roblox.com. To turn it on:
  1. <https://create.roblox.com/dashboard/credentials> → **OAuth 2.0 Apps** → create an app. Members see its name,
     so call it something like "*Game name* Discord Verification".
  2. Scopes **openid** and **profile**; redirect URL `https://<your-service>.onrender.com/oauth/callback`.
  3. Put the client ID and secret in Render (`ROBLOX_OAUTH_CLIENT_ID`, `ROBLOX_OAUTH_CLIENT_SECRET`).
  4. Roblox may limit a new app's users until it's reviewed. Check the app page and leave time for that.

## Tickets

Member clicks a category → fills a short form → a private channel such as `#report-0001` opens with them and
support staff, showing their answers and Roblox account. Staff press **Claim**. **Close** sends a transcript to
the log channel and the member's DMs, then deletes the channel. One open ticket per member.

The categories and their questions are in `config.json` (`ticketTypes`): General Support, Report a Player,
Bug Report, Purchase Issue. Edit and push to change them.

## Running locally

```bash
npm install
cp .env.example .env   # DISCORD_TOKEN, CLIENT_ID, MONGODB_URI (+ GUILD_ID for instant command updates)
npm run deploy
npm start
```

Without `MONGODB_URI`, data goes to `data/db.json`. That's fine on your computer, but never on Render, which wipes
its disk on every deploy.

`npm test` runs the offline tests. To also test against your database:
`MONGODB_TEST_URI="<connection string>" npm test` (uses a throwaway `roblox-bot-test` database).

## Project layout

```
src/
  index.js              starts the bot + web server
  deploy-commands.js    registers slash commands
  config.js             secrets from the environment + config.json
  commands/             one file per slash command (setup.js is the wizard)
  events/               ready (status), member join (welcome + sync), interaction router
  lib/settings.js       per-server settings from /setup
  lib/store.js          MongoDB storage (JSON file fallback for local dev)
  lib/roblox.js         Roblox API calls
  lib/roles.js          role + nickname sync
  lib/oauth.js          Sign in with Roblox
  web/server.js         health check + Roblox sign-in redirect
render.yaml             Render deployment config
```
