import type { ClassGrades } from './types';

/** A text cell that survives commas, quotes and line breaks, and that Excel
 * won't run as a formula — names and titles are typed by users, so one
 * starting with `=`, `+`, `-` or `@` is defused with a leading quote. */
function textCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The grade table as CSV: a row per member, a column per assignment, then
 * the average. Submitted but ungraded reads "илгээсэн"; nothing handed in
 * stays empty. Starts with a BOM so Excel reads the Cyrillic as UTF-8. */
export function gradesCsv(grades: ClassGrades): string {
  const header = ['Гишүүн', ...grades.assignments.map((a) => a.title), 'Дундаж'].map(textCell);
  const rows = grades.students.map((s) => [
    textCell(s.name),
    ...grades.assignments.map((a) => {
      const cell = s.cells[a.id];
      if (!cell) return '';
      return cell.score === null ? 'илгээсэн' : String(cell.score);
    }),
    s.average === null ? '' : String(s.average),
  ]);
  return `﻿${[header, ...rows].map((r) => r.join(',')).join('\r\n')}\r\n`;
}

/** A file name without characters Windows or macOS refuse. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'file';
}
