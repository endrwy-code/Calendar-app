/**
 * Sends alerts and the morning summary, like a calendar app's notifications.
 *
 * Every 20 seconds it looks, for each user the bot can reach, at alerts due in
 * the last 10 minutes (in that user's time zone) and sends any not sent yet.
 * Looking back 10 minutes means an alert missed by a restart or a network
 * hiccup still goes out; the `sent` table makes sure each goes out once.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { format, startOfDay } from 'date-fns';
import { alertsBetween } from '../src/lib/reminders';
import { toDateKey } from '../src/lib/dates';
import { isValidTimeZone, wallClock } from '../src/lib/tz';
import type { Config } from './config';
import type { Messenger } from './bot';
import { agendaText, alertText } from './messages';
import type { Store, User } from './store';
import { TelegramError } from './telegram';

const LOOK_BACK_MS = 10 * 60000;
/** Don't announce an event that started more than this long ago */
const STALE_MS = 5 * 60000;
/** The morning summary is skipped if the server was down for longer than this past its time */
const AGENDA_GRACE_MS = 3 * 3600000;

export class Notifier {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  constructor(
    private store: Store,
    private bot: Messenger,
    private cfg: Config,
  ) {}

  start() {
    const run = async () => {
      await this.tick().catch((e) => console.error('Alerts:', (e as Error).message));
      this.timer = setTimeout(run, 20000);
    };
    this.timer = setTimeout(run, 3000);
  }

  stop() {
    clearTimeout(this.timer);
  }

  async tick(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const user of this.store.reachableUsers()) await this.forUser(user, now);
    } finally {
      this.busy = false;
    }
  }

  private async forUser(user: User, now: number) {
    const { events, tasks, settings } = this.store.userData(user.id);
    if (!settings.telegramAlerts) return;
    const tz = user.tz && isValidTimeZone(user.tz) ? user.tz : this.cfg.defaultTz;
    const nowWall = wallClock(tz, now);

    for (const a of alertsBetween(events, tasks, settings, wallClock(tz, now - LOOK_BACK_MS), nowWall)) {
      if (!a.allDay && a.start.getTime() + STALE_MS < nowWall.getTime()) continue;
      if (this.store.wasSent(user.id, a.key)) continue;
      if (!(await this.deliver(user, alertText(a, nowWall, settings.timeFormat)))) return;
      this.store.markSent(user.id, a.key);
    }

    const at = settings.dailyAgenda && /^\d{2}:\d{2}$/.test(settings.dailyAgenda) ? settings.dailyAgenda : null;
    if (at) {
      const [h, m] = at.split(':').map(Number);
      const due = new Date(nowWall);
      due.setHours(h, m, 0, 0);
      const key = `agenda:${toDateKey(nowWall)}`;
      const late = nowWall.getTime() - due.getTime();
      if (late >= 0 && late < AGENDA_GRACE_MS && !this.store.wasSent(user.id, key)) {
        const day = startOfDay(nowWall);
        const text = agendaText(events, tasks, settings.timeFormat, day, `Good morning! Here’s ${format(day, 'EEEE d MMMM')}`);
        if (await this.deliver(user, text)) this.store.markSent(user.id, key);
      }
    }
  }

  private async deliver(user: User, html: string): Promise<boolean> {
    try {
      await this.bot.send(user.id, html, { app: true });
      return true;
    } catch (e) {
      if (e instanceof TelegramError && (e.code === 403 || (e.code === 400 && /chat not found/i.test(e.description)))) {
        // Blocked the bot or never started it: stop trying until they message it again.
        this.store.setChatOk(user.id, false);
      } else console.error(`Alerts: couldn’t message a user (${(e as Error).message})`);
      return false;
    }
  }
}

/** Daily: tidy up, and keep a copy of the database for each of the last 7 days. */
export function startMaintenance(store: Store, dataDir: string): ReturnType<typeof setInterval> {
  const dir = path.join(dataDir, 'backups');
  const run = () => {
    try {
      store.prune();
      mkdirSync(dir, { recursive: true });
      const name = `daybook-${new Date().toISOString().slice(0, 10)}.db`;
      const existing = readdirSync(dir).filter((f) => /^daybook-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      if (!existing.includes(name)) {
        store.backupTo(path.join(dir, name));
        existing.push(name);
      }
      for (const old of existing.slice(0, -7)) rmSync(path.join(dir, old), { force: true });
    } catch (e) {
      console.error('Backup:', (e as Error).message);
    }
  };
  run();
  return setInterval(run, 6 * 3600000);
}
