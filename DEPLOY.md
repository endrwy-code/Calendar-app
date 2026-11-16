# Putting Daybook online

Daybook runs fine on its own (everything stays on the device), but to keep your
phone and computer in sync and to get alerts as Telegram messages, it needs its
server. The server runs either as one small container (Railway, a VPS) or on
Cloudflare's network (Option D). Either way, it:

- hosts the app at your own https address,
- stores everything in a SQLite database that survives restarts (in a
  container, a copy is made every day and the last 7 are kept),
- keeps your devices in sync (newest edit wins when two devices change the same thing),
- runs your Telegram bot: alerts, a morning summary, `/today`, `/tomorrow`,
  `/next`, quick to-dos (send it any text) and sign-in links for browsers,
- optionally, reads plans out of messages you forward to the bot, with Claude,
  and lets you check and edit them before they're added,
- serves a private calendar link that Apple, Google or Outlook Calendar can subscribe to.

It needs no other services: the database is built into Node, and into
Cloudflare's Durable Objects.

## What you need

1. **A Telegram bot token.** If you already made a bot for the Mini App, reuse it.
   Otherwise open [@BotFather](https://t.me/BotFather), send `/newbot` and follow
   the steps. Treat the token like a password: don't commit it, don't paste it
   into chats (AI chats included), and only put it in your host's settings or
   your server's `.env` file.
2. **Somewhere to run it**, with storage that's kept and an https address.
   Pick one:
   - **[Railway](https://railway.com)**: the easiest. No server to look after; it
     builds from your GitHub repo. Its Free plan gives $1 of usage a month, and
     Daybook is small enough that it should fit (see Option A). Otherwise a few
     dollars a month.
   - **A small VPS** (any Ubuntu server from Hetzner, DigitalOcean, Vultr…): the
     cheapest and you're in full control, but you look after the machine.
   - **Google Cloud's free server**: a small VPS that's free within Google's
     allowance (one server, in the US). A few extra steps; see Option C.
   - **[Cloudflare](https://www.cloudflare.com)**: no server or container to look
     after, and it builds from your GitHub repo. Its Free plan should cover one
     person (see Option D for its limits). It works a little differently: see
     Option D.
3. **Your Telegram username** (or numeric id), so only you can use your server.

## Option A: Railway

1. Sign in to Railway with GitHub. Create a **New Project → Deploy from GitHub
   repo** and pick this repository and the branch you want to run. Railway finds
   the `Dockerfile` and builds it (the build runs the tests too).
2. In the service's **Settings → Networking**, generate a public domain for port
   **8080**. You get an address like `https://daybook-production.up.railway.app`.
3. Attach a **volume** to the service with the mount path **`/data`**. This is
   where the database lives. Without it, your data is lost on every deploy.
   ([Railway's volume guide](https://docs.railway.com/guides/volumes))
4. In the service's **Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `BOT_TOKEN` | your bot token |
   | `APP_URL` | the https address from step 2, no slash at the end |
   | `ALLOWED_USERS` | your Telegram username, e.g. `@yourname` |
   | `DEFAULT_TZ` | your time zone, e.g. `Asia/Singapore` |
   | `RAILWAY_RUN_UID` | `0` (Railway's volumes belong to root; this lets Daybook write to it) |
   | `ANTHROPIC_API_KEY` | optional: your Claude Console key, for plans from forwarded messages |
   | `AI_MODEL` | optional: e.g. `claude-haiku-5-5`, the cheapest (default `claude-opus-5-5`) |

5. Let it redeploy, then open `https://<your address>/api/health`. You should see
   `{"app":"daybook","ok":true,"bot":"your_bot_name"}`. If `bot` is `null`, the
   token is wrong (the deploy logs say so).

To update later, push to the branch; Railway rebuilds and redeploys.

**On Railway's Free plan.** New accounts start with a trial, then move to the
Free plan: $0 a month with $1 of usage. Railway bills for the memory and CPU a
service actually uses ($10 per GB of memory a month, $20 per vCPU a month, at
the time of writing). Daybook uses about 60 MB of memory and almost no CPU
while it waits, which comes to roughly 70 cents a month, so it should fit. It's
close, though: a few days after you deploy, check the project's **Usage** page.
Railway doesn't say what happens to a Free service once the month's credit runs
out. It may stop until the next month. Your data stays on the volume, and the
app keeps working on each device in the meantime; it syncs again when the
server is back.

## Option B: your own server (VPS)

1. Create an Ubuntu 24.04 server (1 GB RAM is plenty) and
   [install Docker](https://docs.docker.com/engine/install/ubuntu/).
2. Give it an address: point a domain's **A record** at the server's IP. No
   domain? Use `<your-ip-with-dashes>.sslip.io` (e.g. `203-0-113-7.sslip.io`),
   which points at your IP for free.
3. Open ports 22, 80 and 443 in the firewall.
4. On the server:

   ```bash
   git clone https://github.com/<you>/calendar-app.git daybook
   ```

   ```bash
   cd daybook && cp .env.example .env && nano .env
   ```

   Fill in `BOT_TOKEN`, `APP_URL` (`https://` + your domain), `ALLOWED_USERS`,
   `DEFAULT_TZ` and `DOMAIN` (just the domain).

   ```bash
   docker compose up -d --build
   ```

   Caddy gets the HTTPS certificate by itself. Check
   `https://<your domain>/api/health`.

To update later:

```bash
git pull && docker compose up -d --build
```

## Option C: Google Cloud's free server

Google Cloud gives one small server a month for free (an `e2-micro`: 1 GB of
memory and a 30 GB disk), which is enough for Daybook. It's a VPS, so after the
Google-specific steps below you carry on with Option B. Google can change what's
free; check [their free tier page](https://docs.cloud.google.com/free/docs/free-cloud-features)
before you start.

1. **Sign up** at [cloud.google.com/free](https://cloud.google.com/free) with
   your Google account. It asks for a card and starts a 90-day trial with credit.
2. **Keep it running after the trial.** When a trial ends, Google stops
   everything in it. In **Billing**, choose **Upgrade** (*Activate full
   account*). The free allowance carries on, and you only pay for what's
   outside it.
3. **Set a budget alert** so a surprise charge can't grow: **Billing → Budgets &
   alerts → Create budget**, a small amount (like 1 in your currency), with email
   alerts.
4. **Create the server**: **Compute Engine → VM instances → Create instance**
   (turn on the Compute Engine API if it asks). Change only these:
   - **Region**: `us-west1` (Oregon), `us-central1` (Iowa) or `us-east1` (South
     Carolina). Only these three are free. Oregon is the closest to Asia.
   - **Machine type**: `e2-micro`.
   - **Boot disk** (*OS and storage → Change*): Ubuntu 24.04 LTS (x86/64), disk
     type **Standard persistent disk**, size **30 GB**. The default (Balanced)
     disk isn't free.
   - **Firewall** (*Networking*): tick **Allow HTTP traffic** and **Allow HTTPS
     traffic**.

   Click **Create** and note the server's **External IP**.
5. **Open a terminal on it**: click **SSH** next to the server. Add 2 GB of swap,
   because 1 GB of memory is tight while the app builds:

   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

6. **Install Docker** with Docker's install script, and let your user run it:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   ```

   ```bash
   sudo usermod -aG docker $USER
   ```

   Close the SSH window and open it again.
7. Carry on with **Option B from step 2**. The firewall (B's step 3) is already
   done. For the address, use `<external-ip-with-dashes>.sslip.io`. The first
   build takes several minutes on this small server.

Good to know:

- Your address is tied to the server's external IP. A restart (`sudo reboot`)
  keeps it, but **Stop** then **Start** in the console gives a new one, and then
  `APP_URL`, `DOMAIN` and the Mini App URL in BotFather all need changing. To
  keep the IP for good, promote it to a static address (**VPC network → IP
  addresses**).
- Google charges for public IPv4 addresses, and its pages don't say clearly
  whether the free allowance covers the one on this server. Your budget alert
  will tell you. If it isn't covered, it's a few US dollars a month.
- 1 GB a month of outbound traffic is free. That's plenty for one person
  (photos you forward to Claude count towards it).

## Option D: Cloudflare (Workers and a Durable Object)

On Cloudflare, Daybook isn't a container. The app's files are served from
Cloudflare's network, and everything else (the API, the database, the bot and
the alerts) lives in one *Durable Object*: a small program with its own SQLite
database. There's no machine to look after and nothing to keep running.

It's the same Daybook with the same features. What's different:

- **Telegram sends the bot's messages to Daybook** (a webhook) instead of
  Daybook asking for them. Daybook sets this up by itself, protected by a
  secret worked out from your bot token.
- **Alerts are checked once a minute** (on a container, every 20 seconds).
- **Backups:** there are no daily copies in a folder. Cloudflare keeps 30 days
  of the database's history (point-in-time recovery), though its docs don't
  say whether the Free plan includes it, and getting an old copy back needs a
  small code change. Keep a copy of your own now and then: **Settings → Backup
  and data → Download a backup**.

### Set it up

1. **Create a Cloudflare account** at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
   (the Free plan is enough to start; see *Free plan limits* below).
2. **Connect the repository.** In the dashboard, go to **Workers & Pages →
   Create → Import a repository**, connect GitHub and pick this repository.
   - **Project name**: `daybook`. It has to match `name` in `wrangler.jsonc`,
     or the build fails.
   - **Branch**: the branch you want to run.
   - **Build command**: leave it empty. **Deploy command**: `npx wrangler deploy`
     (the default). It builds the app first, by itself (`wrangler.jsonc` says how).

   The first deploy takes a few minutes. Your address is
   `https://daybook.<your-subdomain>.workers.dev`.
3. **Add your settings** in the Worker's **Settings → Variables and Secrets**.
   Choose type **Secret** for the two keys:

   | Name | Type | Value |
   | --- | --- | --- |
   | `BOT_TOKEN` | Secret | your bot token |
   | `ALLOWED_USERS` | Text | your Telegram username, e.g. `@yourname` |
   | `DEFAULT_TZ` | Text | your time zone, e.g. `Asia/Singapore` |
   | `APP_URL` | Text | optional: only for your own domain (see below) |
   | `ANTHROPIC_API_KEY` | Secret | optional: for plans from forwarded messages |
   | `AI_MODEL` | Text | optional: e.g. `claude-haiku-5-5` (default `claude-opus-5-5`) |

   Saving deploys a new version. Variables you set here are kept on later
   deploys (`keep_vars` in `wrangler.jsonc`).
4. **Open `https://daybook.<your-subdomain>.workers.dev/api/health`.** That
   first visit tells Daybook its address and connects the bot. Reload after a
   few seconds: you should see `"bot":"your_bot_name"`. If it stays `null`,
   look at the Worker's **Logs** tab (`couldn’t connect the bot` means the
   token is wrong).
5. Carry on with **Point Telegram at it** below, using the workers.dev address.

To update later, push to the branch; Cloudflare builds and deploys it.

**Your own domain (optional).** Under the Worker's **Settings → Domains &
Routes**, add a custom domain. Then set `APP_URL` to it (`https://` and the
domain, no slash at the end), and change the Mini App URL in BotFather. Daybook
moves the bot's webhook over by itself within a minute.

**From your computer instead of the dashboard.** With Node 22 or newer:

```bash
npm ci
```

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

```bash
npx wrangler secret put BOT_TOKEN
```

Add the other settings the same way (`secret put` works for every one of them,
not only the secret ones), or in the dashboard.

### Free plan limits

Cloudflare's Free plan includes Durable Objects with SQLite. Daybook's
once-a-minute alert check uses about 1,500 of the 100,000 requests a day, and
requests for the app's files are free and unlimited. For one person, the
daily allowances for storage, reads and writes are far more than Daybook
needs. ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))

The one to watch is **CPU time**: the Free plan allows 10 ms of computing per
request. Cloudflare's docs aren't consistent about whether that applies to
Durable Objects, so Daybook keeps each request small (it syncs in parts of a
few hundred changes). A very large calendar could still go over, most likely
in the subscription link (`.ics`) or a big import. If the Worker's **Logs**
show `exceeded CPU` errors, move to the Workers Paid plan
([pricing](https://developers.cloudflare.com/workers/platform/pricing/)),
which allows 30 seconds.

### Moving from Railway or a VPS

There's no tool to copy the database across. Your devices carry everything:

1. **Stop the old server** (or remove `BOT_TOKEN` from it). Two servers can't
   share one bot: the old one would keep taking the bot's messages away.
2. Set up Cloudflare as above, and point BotFather's Mini App URL at the new
   address.
3. Open Daybook on each device. Each one signs in to the new server and
   uploads what it has. Check your events are there before deleting the old
   server.
4. Send your bot `/start` once, so it may message you again, then check
   **Settings → Alerts** (alerts, the morning summary and the calendar link
   start afresh on a new server).

## Point Telegram at it

1. In @BotFather: `/mybots` → your bot → **Bot Settings → Configure Mini App**
   (and **Menu Button**) → set the URL to your `APP_URL`. If you made a direct
   link with `/newapp`, edit that too (`/myapps`). The server also sets the menu
   button itself when it starts.
2. Open your bot in Telegram and press **Start**. It replies with what it can do.
3. Open Daybook from the bot's menu button. Inside Telegram it signs you in by
   itself; **Settings → Account** shows your name and "Synced".
4. In **Settings → Alerts**, tap **Send a test message**. Choose the default
   alert for events, and turn on the **Morning summary** if you'd like one.

## Plans from forwarded messages (optional)

Forward the bot a message with plans in it (an announcement, an invite, a
roster), or a photo of a poster, and it suggests events and to-dos. Nothing is
added until you say so:

- **Add all** puts them on your calendar (with **Undo**),
- **Edit in Daybook** opens each one to change or leave out,
- or **reply to the suggestion** in your own words: "make it 3pm", "it's at
  the church hall", "drop the second one".

Forwards that arrive together are read together. Dates like "tomorrow" or
"this Sunday" are read from when the original message was sent. You can also
type `/plan Dinner with Sam next Friday 7pm` to the bot.

To turn it on:

1. Create an API key in the Claude Console (platform.claude.com), and set a
   monthly spend limit there.
2. Add it to your server as `ANTHROPIC_API_KEY` (Railway: Variables; VPS:
   `.env`, then `docker compose up -d`). The log then says
   `Plans from messages: on (claude-opus-5-5)`.
3. In the app: **Settings → Plans from messages → Read forwarded messages
   with Claude**. It's off until each person turns it on.

**Cost.** It uses Claude Opus 5.5 by default, which costs roughly a few US
cents per message read (a photo adds a little). To spend less, set `AI_MODEL`
to `claude-sonnet-5-5` or `claude-haiku-5-5`; they're cheaper and may get
fiddly dates wrong more often. Each person can read at most 30 batches an hour.

**What's sent where.** The text (and photos) you forward go to Anthropic's API
to be read. Before they're sent, phone numbers, emails and NRIC/FIN numbers are
removed. That's a best effort: names and other details stay. The original
message isn't stored on your server, only the suggestions, and those are deleted
after two weeks. If you use Daybook for church or work, check your
organisation's AI policy before forwarding messages from those chats, and don't
forward anything pastoral, medical, financial or about children.

## Bring over what you already have

- **Inside Telegram**, the app keeps its data in Telegram's storage for your bot,
  so it should come along when the bot opens the new address, and goes up to the
  server on the first sync. Check that your events are there before deleting anything.
- **From a browser** (e.g. the GitHub Pages copy): on the old one, **Settings →
  Backup and data → Download a backup**; on the new one, **Import a backup file**.
- **From Google, Apple or Outlook Calendar**: export an `.ics` file there, then
  in Daybook use **Settings → Import a calendar (.ics)**, or on a computer just
  drop the file onto the window. Importing the same file again updates events
  instead of doubling them.

## Use it on a computer

Send `/login` to your bot and open the link it sends (it works once, for 15
minutes). On a computer: `/` searches, `N` adds an event, `D` `3` `W` `M` `L`
switch views, `T` goes to today, `←` `→` change page, and `+` `−` `0` (or Ctrl +
scroll) zoom the hours.

## See Daybook in another calendar app (optional)

**Settings → Show Daybook in another calendar app** gives you a private link.
Add it in Apple Calendar (*File → New Calendar Subscription*), Google Calendar
(*Other calendars → From URL*) or Outlook (*Add calendar → Subscribe from web*).
It updates by itself (how often depends on that app). Anyone with the link can
see your events, so keep it to yourself; **Turn off link** stops it working.

## Your data

- In a container, everything is in one file, `/data/daybook.db`. Every day a
  copy is written to `/data/backups/` and the last 7 are kept. On Cloudflare,
  it's in the Durable Object's own database (see Option D for its history).
  Now and then, keep a copy somewhere else as well: **Settings → Backup and
  data → Download a backup** from the app, or on a VPS
  `docker compose cp daybook:/data/backups ./backups`.
- Alerts and the morning summary are Telegram messages, so event titles, times
  and places pass through Telegram like any chat. Keep anything sensitive out of
  event titles and notes.
- Sign-in links, sessions and calendar links are stored only as hashes, so a
  copy of the database can't be used to sign in.
- If your bot token ever leaks: @BotFather → `/revoke`, then put the new token in
  your host's variables (or `.env`) and restart. On Cloudflare, saving the new
  secret is enough; the webhook secret changes with it.

## If something's off

| You see | What to do |
| --- | --- |
| Logs: `couldn’t connect the bot (Telegram 401)` | `BOT_TOKEN` is wrong. |
| Logs: `another copy of this bot is running` | Two servers are using the same bot (often a local test copy). Use a separate bot for testing. |
| App: "This Daybook server is private." | Add your username or id to `ALLOWED_USERS`. |
| No alerts arrive | Press **Start** in your bot's chat once, then **Settings → Alerts → Let @bot message you**. |
| Alerts at the wrong time | Open the app once on your phone, which tells the server your time zone, or set `DEFAULT_TZ`. |
| Data gone after a Railway deploy | The volume isn't mounted at `/data`. |
| Bot says the Anthropic API key was turned down | Check `ANTHROPIC_API_KEY`, and that the key's workspace has credit. |
| Forwarded messages become to-dos instead | `ANTHROPIC_API_KEY` isn't set on the server. |
| Cloudflare: `/api/health` shows `"bot":null` | Reload after a few seconds. Still `null`: check `BOT_TOKEN`, and the Worker's **Logs**. |
| Cloudflare: the bot doesn't answer | Another copy of the bot is running (an old server, or a local test with the same token). Stop it; Daybook takes the webhook back within an hour. |
| Cloudflare: Logs show `exceeded CPU` | The Free plan's CPU limit; see *Free plan limits* in Option D. |
| Cloudflare: the build fails on the project name | Name the Worker `daybook`, as in `wrangler.jsonc`. |

## Running the server on your computer

```bash
npm install
```

```bash
BOT_TOKEN=<a test bot's token> APP_URL=http://localhost:8080 npm run server
```

Then open http://localhost:8080. To work on the app with live reload against
that server, run Vite with the API passed through:

```bash
DAYBOOK_SERVER=http://localhost:8080 npm run dev
```

To try the Cloudflare version on your computer (it runs Cloudflare's own
runtime locally), put your test settings in a `.dev.vars` file (same format as
`.env`; it's never committed), then:

```bash
npm run cf:dev
```

All settings: `PORT` (8080), `DATA_DIR` (`./data`), `BOT_TOKEN`, `APP_URL`,
`ALLOWED_USERS`, `DEFAULT_TZ` (UTC), `TRUST_PROXY` (`1`; set `0` if the server
faces the internet directly), `BOT_POLLING` (`1`), `ANTHROPIC_API_KEY`,
`AI_MODEL` (`claude-opus-5-5`).
