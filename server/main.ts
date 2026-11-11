/**
 * Daybook server: hosts the app, stores your calendar in SQLite, keeps your
 * devices in sync, and runs the Telegram bot that sends alerts.
 *
 * Configure it with environment variables (see .env.example), then:
 *   npm run build && npm run build:server && npm start
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { Store } from './store';
import { Bot } from './bot';
import { BotApi } from './telegram';
import { Notifier, startMaintenance } from './notify';
import { createApp } from './http';
import { PlanReader } from './claude';

// Times are kept as wall-clock strings and worked out per user's zone, which
// relies on the server's own clock being UTC.
process.env.TZ = 'UTC';

const cfg = loadConfig();
mkdirSync(cfg.dataDir, { recursive: true });
const store = new Store(path.join(cfg.dataDir, 'daybook.db'));

let bot: Bot | null = null;
let notifier: Notifier | null = null;
if (cfg.botToken) {
  const reader = cfg.anthropicKey ? new PlanReader({ apiKey: cfg.anthropicKey, model: cfg.aiModel, baseUrl: process.env.ANTHROPIC_BASE_URL }) : null;
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

const maintenance = startMaintenance(store, cfg.dataDir);
const server = createApp({ store, cfg, bot });
server.listen(cfg.port, () => console.log(`Daybook is running on port ${cfg.port}`));

const shutdown = () => {
  console.log('Shutting down…');
  bot?.stop();
  notifier?.stop();
  clearInterval(maintenance);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
