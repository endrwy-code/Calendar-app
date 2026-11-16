/**
 * Daybook server on Node: hosts the app, stores your calendar in SQLite, keeps
 * your devices in sync, and runs the Telegram bot that sends alerts. (For
 * Cloudflare, see worker/index.ts.)
 *
 * Configure it with environment variables (see .env.example), then:
 *   npm run build && npm run build:server && npm start
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { Store } from './store';
import { NodeSql } from './sqlite-node';
import { Bot } from './bot';
import { BotApi } from './telegram';
import { Notifier } from './notify';
import { createApp } from './http';
import { PlanReader } from './claude';

// Times are kept as wall-clock strings and worked out per user's zone, which
// relies on the server's own clock being UTC.
process.env.TZ = 'UTC';

const cfg = loadConfig(process.env);
const dataDir = path.resolve(cfg.dataDir);
mkdirSync(dataDir, { recursive: true });
const sql = new NodeSql(path.join(dataDir, 'daybook.db'));
const store = new Store(sql);

let bot: Bot | null = null;
let notifier: Notifier | null = null;
if (cfg.botToken) {
  const reader = cfg.anthropicKey ? new PlanReader({ apiKey: cfg.anthropicKey, model: cfg.aiModel, baseUrl: cfg.anthropicBaseUrl ?? undefined }) : null;
  if (reader) console.log(`Plans from messages: on (${cfg.aiModel})`);
  bot = new Bot(new BotApi(cfg.botToken), store, cfg, reader);
  if (cfg.polling) bot.start();
  else void bot.init();
  notifier = new Notifier(store, bot, cfg);
  notifier.start();
} else {
  console.warn('BOT_TOKEN isn’t set: Telegram sign-in, alerts and the bot are off.');
}
if (!cfg.appUrl) console.warn('APP_URL isn’t set: sign-in links from the bot won’t work.');
if (!cfg.allowed) console.warn('ALLOWED_USERS isn’t set: anyone who finds your bot can use this server.');

/** Every 6 hours: tidy up, and keep a copy of the database for each of the last 7 days. */
function maintenance() {
  const dir = path.join(dataDir, 'backups');
  try {
    store.prune();
    mkdirSync(dir, { recursive: true });
    const name = `daybook-${new Date().toISOString().slice(0, 10)}.db`;
    const existing = readdirSync(dir).filter((f) => /^daybook-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    if (!existing.includes(name)) {
      sql.backupTo(path.join(dir, name));
      existing.push(name);
    }
    for (const old of existing.slice(0, -7)) rmSync(path.join(dir, old), { force: true });
  } catch (e) {
    console.error('Backup:', (e as Error).message);
  }
}
maintenance();
const maintenanceTimer = setInterval(maintenance, 6 * 3600000);

const server = createApp({ store, cfg, bot });
server.listen(cfg.port, () => console.log(`Daybook is running on port ${cfg.port}`));

const shutdown = () => {
  console.log('Shutting down…');
  bot?.stop();
  notifier?.stop();
  clearInterval(maintenanceTimer);
  server.close(() => {
    sql.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
