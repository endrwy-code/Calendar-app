import { useData } from '../store/data';

export function CalendarPicker(props: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
}) {
  const calendars = useData((s) => s.calendars);
  return (
    <div className="chip-row">
      {props.allowNone && (
        <button className="chip" aria-pressed={!props.value} onClick={() => props.onChange(null)}>
          None
        </button>
      )}
      {calendars.map((c) => (
        <button
          key={c.id}
          className={`chip c-${c.color}`}
          aria-pressed={props.value === c.id}
          onClick={() => props.onChange(c.id)}
        >
          <span className="dot" />
          {c.name}
        </button>
      ))}
    </div>
  );
}
