/** Saving and opening files: backups and .ics calendars. */
import { useUI } from '../store/ui';
import { parseIcs, type IcsImport } from './ics';
import { isTelegram } from './telegram';
import { sendFileToChat, useSync } from './sync';

/**
 * Saves a file. Telegram's in-app browser can't download files, so inside
 * Telegram (when the server is connected) the bot sends it to your chat
 * instead, where you can open or share it.
 */
export async function saveFile(name: string, content: string, mime: string): Promise<'sent' | 'downloaded'> {
  const s = useSync.getState();
  if (isTelegram && s.mode === 'ready' && s.chatOk && (await sendFileToChat(name, content, mime))) {
    useUI.getState().toast(`Sent ${name} to your Telegram chat`);
    return 'sent';
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export const isIcsFile = (f: File) => /\.(ics|ical|icalendar|ifb)$/i.test(f.name) || f.type === 'text/calendar';

/** Reads one or more .ics files and opens the import sheet to confirm. */
export async function openIcsFiles(files: File[]) {
  const toast = useUI.getState().toast;
  const ics = files.filter(isIcsFile);
  if (!ics.length) {
    toast('Only calendar files (.ics) can be imported here');
    return;
  }
  const merged: IcsImport = { name: null, events: [], simplified: 0, skipped: 0 };
  for (const f of ics) {
    try {
      const r = parseIcs(await f.text());
      merged.name ??= r.name;
      merged.events.push(...r.events);
      merged.simplified += r.simplified;
      merged.skipped += r.skipped;
    } catch {
      merged.skipped++;
    }
  }
  if (!merged.events.length) {
    toast('No events found in that file');
    return;
  }
  const fileName = ics.length === 1 ? ics[0].name : `${ics.length} files`;
  useUI.getState().setImporting({ fileName, result: merged });
}
