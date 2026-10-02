export interface DueInfo {
  label: string;
  overdue: boolean;
}

// Due dates are entered and shown in Ulaanbaatar time wherever the viewer is.
const TIME_ZONE = 'Asia/Ulaanbaatar';
const END_OF_DAY = '23:59';

/** `YYYY-MM-DD` of a stored due date, for a date input. */
export function dueDateInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
}

/** `HH:MM` of a stored due date, for a time input — empty when it is the
 * end-of-day default, i.e. the admin only picked a date. */
export function dueTimeInput(iso: string | null): string {
  if (!iso) return '';
  const time = new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return time === END_OF_DAY ? '' : time;
}

/** What to send as `dueAt` from a date input plus an optional time input. */
export function dueInputValue(date: string, time: string): string | null {
  if (!date) return null;
  return time ? `${date}T${time}:00+08:00` : date;
}

/** "аравдугаар сарын 5", plus ", 18:00" when a time was set. */
export function formatDue(due: Date): string {
  const day = due.toLocaleDateString('mn-MN', {
    timeZone: TIME_ZONE,
    month: 'long',
    day: 'numeric',
  });
  const time = dueTimeInput(due.toISOString());
  return time ? `${day}, ${time}` : day;
}

export function dueInfo(dueAt: string | null): DueInfo {
  if (!dueAt) return { label: 'Хугацаагүй', overdue: false };
  const due = new Date(dueAt);
  return { label: `Хугацаа: ${formatDue(due)}`, overdue: due.getTime() < Date.now() };
}

/** Parses the `dueAt` a client sends. A plain date ("2026-10-05") means the
 * whole day counts, so it is stored as 23:59:59 Ulaanbaatar time (UTC+8) —
 * otherwise a due date of today would read as overdue from midnight.
 * Returns null for empty input and undefined for an invalid date. */
export function parseDueInput(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59+08:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
