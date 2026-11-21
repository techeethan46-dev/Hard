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
| 🔥 Streak roles | Pick a role and the number of days of streak that unlocks it |
| 🧷 When a streak ends | Take the streak roles away (default) or let people keep them |
| 🕛 Streak timezone | When a "day" ends for chat streaks (default UTC) |
| 🧾 Server log channel | Message deletes/edits, role and nickname changes, timeouts |
| 📥 Join log channel | Everyone who joins |
| 📤 Leave log channel | Everyone who leaves |
| 🚨 Raid protection | Off / Normal / Strict |
| 👶 Minimum account age | Kick accounts younger than this when they join |

The summary page also runs checks and tells you what to fix in plain words, like "drag the bot's role above
@Verified" or "the bot can't post in #mod-log".

After setup: run `/panel verify` in your verify channel and `/panel tickets` in your support channel.
Skip any step you don't need; that feature just stays off.

## Commands

| Command | Who | What it does |
|---|---|---|
| `/balance`, `/daily`, `/pay` | Everyone | Your coins, a free daily reward, and sending coins to someone |
| `/shop view` | Everyone | Buy roles with coins (staff add and remove roles in `/economy setup`) |
| `/coinflip`, `/slots`, `/blackjack`, `/roulette` | Everyone | Games you play with coins |
| `/economy give/take` | Admins | Give coins to someone or take some back |
| `/economy setup` | Admins | One screen for the role shop: pick a role, type its price and its daily boost % |
| `/help` | Everyone | A private menu of the commands, grouped by category. People only see the commands they can use |
| `/verify` or the **Verify** button | Everyone | Links a Roblox account (see below) |
| `/update [member]` | Everyone (staff for others) | Re-syncs roles and nickname, e.g. after a promotion |
| `/unverify` | Everyone | Unlinks your Roblox account |
| `/whois [member] [username]` | Everyone | Roblox profile and linked Discord account |
| `/game` | Everyone | Players online, visits, favorites, last update, Play button |
| `/rank [member]` | Everyone | Level, XP progress, server position, streak and restores |
| `/leaderboard` | Everyone | Top 10 by level or by streak (buttons to switch) |
| `/streak` | Everyone | Your streak, restores left, and a Restore button when it broke |
| `/xp set-level/give/reset` | Admins | Adjust someone's level or XP (`reset` only resets XP) |
| `/streak-admin set/reset/restores` | Admins | Set or remove someone's streak, or refill their restores |
| `/raidmode on/off/status` | Admins | Turn raid mode on or off by hand |
| `/message create/edit/welcome` | Admins | Write rules and announcements from cards and banners, edit them later, and write your own welcome message |
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
- **Changing your own nickname is fine:** the bot puts your 🔥 badge (and `[AFK]` tag) back right away.
- **Streak roles:** set them in `/setup` (e.g. 7 days → @Week Warrior). The role is given the moment the streak reaches
  the days, with a 🔥 announcement. By default the roles follow the current streak: they're taken away when it ends
  and given back if it's restored. Choose **Let them keep the roles** in `/setup` to keep them once earned.
- `/xp reset` only resets XP; use `/streak-admin` for streaks.
- The bot can't rename the server owner or anyone whose role is above the bot's, so they won't get a badge.

## Rules, announcements and the welcome message

`/message create` opens a private builder. A message is made of **blocks**, each shown as a card:
- **🖼️ Banner:** a picture (like the "COMMUNITY RULES" banner), with a colored edge.
- **📄 Card:** your text (supports `## Headings`, `**bold**`, `• bullets`, `-# small text` and server emojis), plus an
  optional color, a small picture on the right, a big picture at the bottom, and up to 5 link buttons
  (`Play now | https://www.roblox.com/games/123`).

Use **Edit, Up, Down, Delete** on any block, **Preview** to see the real thing (only you see it), then **Post message**.
`/message edit` lists the messages you made this way (by channel and title) so you can change them any time; the live
message is updated in place. Messages that were deleted are forgotten.

Good to know:
- **Linking channels and roles:** just type `#rules` or `@VIP` in the text and it becomes a real, clickable link when you
  save (names are matched ignoring case, spaces and symbols, so `#rules` finds `┃📜・rules`; for a role with spaces, leave
  the spaces out, like `@ServerBooster`). If two channels share a name it's left alone. You can also paste `<#channelID>`
  yourself. Role links don't ping anyone.
- One message holds **3,800 characters** (Discord's limit is 4,000 per message). For long rules, make several messages one
  after another, like a banner message followed by one message per section.
- Picture links must start with `https://` and point straight to the picture (Imgur, a GitHub raw link, etc.). Pasted
  Discord attachment links can stop working after a while, so use a permanent host for banners.
- Nobody is pinged by a posted message, so you can't accidentally `@everyone`.

**Welcome message:** new members get a welcome card in the **Welcome channel** (set in `/setup`). `/message welcome` lets
you write your own with placeholders `{user}` `{username}` `{server}` `{count}` `{game}`, and `{avatar}` / `{servericon}` for
pictures. **Back to the default** returns to the standard card. If another bot (like Carl-bot) already welcomes people, turn
one of them off or members get two welcomes.

## Coins and games

Coins are the server's fake currency. They have no link to Robux or real money.

- **Earning:** 2–5 coins on each message that also earns XP (so at most once a minute), and **250 coins every day** with
  `/daily` (the day follows the streak timezone from `/setup`).
- **Daily boost roles:** run `/economy setup`, pick a role, then type its price and a boost percent (20 means +20% on
  `/daily`, which gives 250 coins). The role goes on sale in `/shop` and shows its perk. Only a member's best boost
  counts, and losing the role loses the boost. Suggested tiers: Bronze +20% (300 a day), Silver +50% (375), Gold +100% (500), priced so Bronze
  takes about a week of dailies, Silver about 3 weeks and Gold about 2 months.
- **Using:** `/balance`, `/pay`, and the **role shop**: staff put roles up for sale in `/economy setup`, and members
  pick one from `/shop view`, confirm, and buy it. If Discord refuses to give the role, the coins are refunded. Roles with
  moderator or admin permissions can't be sold. The **Coins** button on `/leaderboard` shows the richest members.
- **Bets:** type a number (`500`), `1.5k`, `all` or `half`. Smallest bet 10, no maximum. Coins are taken in one safe
  step, so two quick bets can't spend the same coins.
- **The bank** (`/bank`): a shared fund everyone can see. It starts with **100,000** coins (once) and gets a **45% tax**
  on chat coins, on `/pay` (the receiver gets 55%) and on game profit (not on `/daily`). Every `/daily` is paid by the
  bank first; if the bank is short, the rest is created new so nobody is refused.
  - **Tax on a win:** after a win a private message offers **Pay tax** or **Don't pay tax** for 10 seconds (no answer
    means you pay; the tax is already in the bank). Not paying is a 60% chance of being caught, and then the bank
    takes 80% of all your coins. Above 100,000 coins you are asked to confirm first.
  - **`/bank rob`:** 5% chance to take 30% of the bank. It costs 10% of your coins (at least 5,000, goes to the bank),
    once every 24 hours per person, and the result is posted for everyone. Not possible when the bank is under 1,000.
  - **`/bank loan` / `/bank repay`:** needs a linked Roblox account and level 5. Borrow 100 to 2,000 (and at most 10% of
    the bank), pay back 10% extra within 3 days. After the deadline half of everything you receive goes to the debt,
    and you can't gamble or buy from the shop until it is paid.
- **Games:**
  - `/coinflip` heads or tails, double or nothing.
  - `/slots` three of a kind pays 4× up to 500× (💎 and 7️⃣ are the jackpots), two matching returns your bet. Pays back about 87%.
  - `/blackjack` Hit, Stand or Double. Blackjack pays 3 to 2, the dealer stands on 17, and an idle hand stands by itself
    after 2 minutes. If the bot restarts in the middle of a hand, that bet is lost.
  - `/roulette` bet, then pick Red, Blue or Green (each 1 in 3). A win pays 2.7×. The coins are taken when you pick.

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
**only one at a time** (picking one removes the others, good for regions or colors), and choose a style:
- **Reactions** (default): the panel lists `emoji · @role` and the bot adds the reactions. Members react to get the
  role and remove their reaction to lose it. Each role gets an emoji automatically (its own emoji, or one from a
  palette); change any of them in the builder. Up to 20 roles, and only emojis from your server or standard emojis.
- **Buttons**, or a **dropdown**.

Edit the title and text, then press **Post here**. Roles with moderator/admin permissions, bot roles,
and roles above the bot's role are blocked automatically. A role's emoji (if it has one) shows on its button.

**Sticky messages:** `/sticky set` in a channel. The bot reposts it at the bottom a few seconds after chat goes
quiet (at most every 15 seconds in a busy channel) and deletes the old copy, so there's only ever one.

**AFK:** type `r!afk Too tired`. Your name becomes `[AFK] Superman` (the 🔥 streak badge stays). Anyone who pings
you or replies to you gets "💤 Superman is AFK: Too tired · 2 hours ago" (once a minute per channel). Send any
message to come back: you get a welcome-back card listing who pinged you, with jump links.

## Raid protection and logs

**Raid protection**: if 10 people (5 on Strict) join within 30 seconds, raid mode turns on. Accounts younger
than 30 days are kicked with a polite DM, staff get an alert with an **End raid mode** button, and it switches
off by itself after 10 quiet minutes. `/raidmode` turns it on or off by hand. Separately, **Minimum account age**
kicks very new accounts at any time.

**Logs** are split across channels (set them in `/setup`; one that isn't set falls back to the server log):
- **Mod log:** kicks, bans and unbans, with who did it and why. This includes ones done from Discord itself, not just
  `/kick` and `/ban` (those are never posted twice). Raid alerts, warnings and timeouts from commands go here too.
- **Join log:** everyone who joins (flags accounts under 7 days old). Bots show as *Bot added*.
- **Leave log:** everyone who leaves, with their roles. Bots show as *Bot removed*.
- **Server log:** deleted messages (with text and file names), edits (before/after with a jump button), bulk deletes
  (as a text file), nickname changes (the 🔥 streak badge and `[AFK]` tag are ignored) and timeouts. Role changes for
  the same person are merged into **one message** with *Roles added* and *Roles removed* lines, plus who changed them.

Telling a leave from a kick or ban, and knowing who did it, needs the **View Audit Log** permission.

These need **Message Content Intent** turned on in the Developer Portal (Bot tab).

## Verification

The bot uses the first of these that is set up:

- **Bloxlink** (easiest for members, no Roblox app review): members verify once with the Bloxlink bot and the bot
  reads that link. To turn it on:
  1. Add the Bloxlink bot to the server. The server owner (or someone who manages it) opens
     <https://blox.link> > **Developer API**, picks the server and presses **Add**.
  2. Press **See Key** and put it in Render as `BLOXLINK_API_KEY`. Never share it in chat.
  3. Members run `/verify` (or press **Verify**). If they haven't verified with Bloxlink yet, the bot tells them to
     and gives a **Check again** button. `/update` picks up a changed Roblox account.
  The free key allows 2,000 lookups a day, which is plenty.
- **Profile code** (default if nothing else is set): the member types their username, pastes a 6-word code into their Roblox
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

## Startup

- **Startup never depends on Discord's command registry:** if registering the slash commands fails (a rate limit or outage),
  the bot prints a warning and starts anyway, using the commands Discord already has.

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
