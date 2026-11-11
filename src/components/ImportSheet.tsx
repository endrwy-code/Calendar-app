import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Check, Repeat } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { parseLocal, todayKey } from '../lib/dates';
import { haptic } from '../lib/telegram';
import { openIcsFiles } from '../lib/files';
import { Sheet } from './Sheet';
import { nextTagColor } from './TagPicker';

const NEW = '__new__';

/**
 * Confirms an .ics import: how many events, which tag they go under, and a
 * peek at the first few. Re-importing the same file updates events instead of
 * adding them twice. Undo puts everything back.
 */
export function ImportSheet() {
  const importing = useUI((s) => s.importing);
  if (!importing) return null;
  return <ImportInner key={importing.fileName + importing.result.events.length} />;
}

function ImportInner() {
  const { fileName, result } = useUI((s) => s.importing)!;
  const setImporting = useUI((s) => s.setImporting);
  const toast = useUI((s) => s.toast);
  const calendars = useData((s) => s.calendars);
  const events = useData((s) => s.events);
  const name = result.name?.trim() || null;
  const match = name ? calendars.find((c) => c.name.trim().toLowerCase() === name.toLowerCase()) : undefined;
  const [tag, setTag] = useState<string>(match?.id ?? (name ? NEW : calendars[0]?.id));

  const known = useMemo(() => new Set(events.map((e) => e.icsUid).filter(Boolean)), [events]);
  const updates = result.events.filter((e) => known.has(e.icsUid)).length;
  const fresh = result.events.length - updates;
  const tagNames = new Set(calendars.map((c) => c.name.trim().toLowerCase()));
  const keepTags = result.events.some((e) => e.categories.some((c) => tagNames.has(c.trim().toLowerCase())));

  const preview = useMemo(() => {
    const today = todayKey();
    const sorted = [...result.events].sort((a, b) => a.start.localeCompare(b.start));
    const upcoming = sorted.filter((e) => e.start.slice(0, 10) >= today || e.recurrence);
    return (upcoming.length ? upcoming : sorted).slice(0, 4);
  }, [result]);

  const run = (close: () => void) => {
    const data = useData.getState();
    let tagId = tag;
    let newTagId: string | null = null;
    if (tag === NEW && name) {
      newTagId = tagId = data.addCalendar({ name, color: nextTagColor(data.calendars) }).id;
    }
    const { added, updated, previous } = data.importEvents(
      result.events.map(({ categories, ...e }) => ({ ...e, categories })),
      tagId,
    );
    haptic.success();
    const parts = [added && `Imported ${added} event${added === 1 ? '' : 's'}`, updated && `updated ${updated}`].filter(Boolean);
    const msg = parts.join(', ');
    toast(msg.charAt(0).toUpperCase() + msg.slice(1), {
      label: 'Undo',
      run: () =>
        useData.setState((s) => ({
          events: previous,
          calendars: newTagId ? s.calendars.filter((c) => c.id !== newTagId) : s.calendars,
        })),
    });
    close();
  };

  const count = result.events.length;
  return (
    <Sheet
      onClose={() => setImporting(null)}
      size="large"
      title="Import events"
      left={(close) => (
        <button className="text-btn" onClick={close}>
          Cancel
        </button>
      )}
      right={(close) => (
        <button className="text-btn bold" onClick={() => run(close)}>
          Import
        </button>
      )}
    >
      <div className="form">
        <div className="import-summary">
          <strong>
            {count} event{count === 1 ? '' : 's'}
          </strong>
          <span>from {fileName}</span>
          {(updates > 0 || result.simplified > 0 || result.skipped > 0) && (
            <small>
              {[
                updates > 0 && `${fresh} new, ${updates} already here (they’ll be updated)`,
                result.simplified > 0 && `${result.simplified} repeat rule${result.simplified === 1 ? '' : 's'} simplified`,
                result.skipped > 0 && `${result.skipped} couldn’t be read`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </div>

        <div className="group-label">Add them to</div>
        <div className="tag-pick group import-tags" role="listbox" aria-label="Tag">
          {name && !match && (
            <button role="option" aria-selected={tag === NEW} className={`tag-opt c-${nextTagColor(calendars)}`} onClick={() => setTag(NEW)}>
              <span className="tag-dot" />
              <span className="tag-name">
                {name} <small className="tag-hint">new tag</small>
              </span>
              {tag === NEW && <Check size={18} strokeWidth={2.4} className="tag-check" />}
            </button>
          )}
          {calendars.map((c) => (
            <button key={c.id} role="option" aria-selected={tag === c.id} className={`tag-opt c-${c.color}`} onClick={() => setTag(c.id)}>
              <span className="tag-dot" />
              <span className="tag-name">{c.name}</span>
              {tag === c.id && <Check size={18} strokeWidth={2.4} className="tag-check" />}
            </button>
          ))}
        </div>
        {keepTags && <p className="form-foot">Events whose category matches one of your tags keep that tag.</p>}

        <div className="group-label">{preview.length < count ? 'First few' : 'Events'}</div>
        <div className="group rows">
          {preview.map((e) => {
            const d = parseLocal(e.start);
            return (
              <div key={e.icsUid} className="row">
                <span className="row-main two">
                  <span className="import-title">{e.title}</span>
                  <small>
                    {format(d, 'EEE d MMM yyyy')}
                    {!e.allDay && ` · ${e.start.slice(11)}`}
                  </small>
                </span>
                {e.recurrence && <Repeat size={15} className="row-icon" aria-label="Repeats" />}
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

/** Drop .ics files anywhere on the window to import them. */
export function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void openIcsFiles([...e.dataTransfer!.files]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="drop-zone" aria-live="polite">
      <div className="drop-card">
        <strong>Drop to import</strong>
        <span>Calendar files (.ics) from Google, Apple or Outlook</span>
      </div>
    </div>
  );
}
