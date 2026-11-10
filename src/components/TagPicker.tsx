import { useState } from 'react';
import { Check } from 'lucide-react';
import { useData } from '../store/data';
import { COLOR_KEYS, type CalendarCategory, type ColorKey } from '../types';
import { haptic } from '../lib/telegram';

/** The first colour no tag uses yet (or the next in turn once all are taken). */
export function nextTagColor(tags: CalendarCategory[]): ColorKey {
  const used = new Set(tags.map((t) => t.color));
  return COLOR_KEYS.find((k) => !used.has(k)) ?? COLOR_KEYS[tags.length % COLOR_KEYS.length];
}

/**
 * Pick one of your tags, or name a new one right here. Shown inline under the
 * Tag row, so the form only ever shows the one tag you chose.
 */
export function TagPicker({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const tags = useData((s) => s.calendars);
  const addCalendar = useData((s) => s.addCalendar);
  const [name, setName] = useState('');
  const color = nextTagColor(tags);

  return (
    <div className="tag-pick" role="listbox" aria-label="Tag">
      {tags.map((t) => (
        <button
          key={t.id}
          role="option"
          aria-selected={t.id === value}
          className={`tag-opt c-${t.color}`}
          onClick={() => {
            haptic.select();
            onPick(t.id);
          }}
        >
          <span className="tag-dot" />
          <span className="tag-name">{t.name}</span>
          {t.id === value && <Check size={18} strokeWidth={2.4} className="tag-check" />}
        </button>
      ))}
      <form
        className={`tag-opt tag-new c-${color}`}
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          const t = addCalendar({ name: n, color });
          haptic.tap();
          setName('');
          onPick(t.id);
        }}
      >
        <span className="tag-dot" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" aria-label="New tag name" enterKeyHint="done" />
        {name.trim() && (
          <button type="submit" className="tag-add">
            Add
          </button>
        )}
      </form>
    </div>
  );
}
