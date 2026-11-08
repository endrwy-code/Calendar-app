import { describe, expect, it } from 'vitest';
import { orderTodos, suggestSlots } from '../selectors';
import type { CalEvent, Task } from '../../types';

const task = (p: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2),
  title: 't',
  status: 'todo',
  priority: 'none',
  durationMin: 30,
  subtasks: [],
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

describe('orderTodos', () => {
  it('groups by status: newest open first, most recently completed first', () => {
    const a = task({ title: 'a', createdAt: 1 });
    const b = task({ title: 'b', createdAt: 2 });
    const c = task({ title: 'c', status: 'in_progress', createdAt: 3 });
    const d = task({ title: 'd', status: 'done', completedAt: 10 });
    const e = task({ title: 'e', status: 'done', completedAt: 20 });
    const g = orderTodos([a, b, c, d, e]);
    expect(g.todo.map((t) => t.title)).toEqual(['b', 'a']);
    expect(g.in_progress.map((t) => t.title)).toEqual(['c']);
    expect(g.done.map((t) => t.title)).toEqual(['e', 'd']);
  });
});

describe('suggestSlots', () => {
  it('offers the next free slot, then one on each following day', () => {
    const now = new Date(2026, 10, 9, 9, 10); // Mon 09:10
    const busy: CalEvent = {
      id: 'e1',
      title: 'Meeting',
      calendarId: 'work',
      start: '2026-11-09T09:00',
      end: '2026-11-09T11:00',
      allDay: false,
      createdAt: 0,
      updatedAt: 0,
    };
    const slots = suggestSlots({ id: 'x', durationMin: 30 }, [busy], [], 8, 22, 3, now);
    expect(slots).toEqual(['2026-11-09T11:00', '2026-11-10T08:00', '2026-11-11T08:00']);
  });

  it('skips time already blocked by another to-do', () => {
    const now = new Date(2026, 10, 9, 7, 0);
    const other = task({ id: 'o', scheduledStart: '2026-11-09T08:00', durationMin: 60 });
    const [first] = suggestSlots({ id: 'x', durationMin: 30 }, [], [other], 8, 22, 1, now);
    expect(first).toBe('2026-11-09T09:00');
  });
});
