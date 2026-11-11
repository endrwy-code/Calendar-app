/**
 * Time-zone arithmetic with the built-in Intl API (no tz database to ship).
 *
 * Daybook stores times as local wall-clock strings ("2026-11-11T09:00"). Two
 * places need to move between wall clocks and real instants: importing .ics
 * files written in another zone, and the server, which fires alerts at the
 * right moment in each user's zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Minutes the zone is ahead of UTC at the instant `ms` (Europe/London in summer: 60). */
export function tzOffset(tz: string, ms: number): number {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `tz` shows the given time. */
export function zonedToInstant(tz: string, y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  const first = tzOffset(tz, guess);
  const ms = guess - first * 60000;
  const second = tzOffset(tz, ms);
  return second === first ? ms : guess - second * 60000;
}

/**
 * The wall clock in `tz` at instant `ms`, as a Date whose UTC fields hold the
 * wall-clock time. Read it with getUTC* (or with local getters in a process
 * that runs with TZ=UTC, as the server does).
 */
export function wallClock(tz: string, ms: number): Date {
  return new Date(ms + tzOffset(tz, ms) * 60000);
}

/** Device time zone, e.g. "Asia/Singapore". */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Common Windows zone names (Outlook writes these in .ics files) mapped to IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  'Singapore Standard Time': 'Asia/Singapore',
  'Malay Peninsula Standard Time': 'Asia/Kuala_Lumpur',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'India Standard Time': 'Asia/Kolkata',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'W. Australia Standard Time': 'Australia/Perth',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Arabian Standard Time': 'Asia/Dubai',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'E. South America Standard Time': 'America/Sao_Paulo',
  UTC: 'UTC',
};

/**
 * Turns a TZID from an .ics file into a zone Intl understands: IANA names as-is,
 * Windows names via the table above, and prefixed ids such as
 * "/mozilla.org/20050126_1/Europe/London" by their trailing Area/City.
 */
export function resolveTimeZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const id = tzid.replace(/^"|"$/g, '').trim();
  if (isValidTimeZone(id)) return id;
  const win = WINDOWS_ZONES[id];
  if (win) return win;
  const parts = id.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('/');
    if (isValidTimeZone(candidate)) return candidate;
  }
  return null;
}
