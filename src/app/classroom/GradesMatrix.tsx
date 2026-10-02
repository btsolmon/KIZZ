'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { saveBlob } from '@/lib/download';
import { gradesCsv, safeFileName } from '@/lib/gradesCsv';
import { useToast } from '@/lib/toast';
import type { ApiError, ClassGrades, GradeCell } from '@/lib/types';

function scoreClass(score: number) {
  if (score >= 80) return 'bg-mint text-white';
  if (score >= 50) return 'bg-amber text-white';
  return 'bg-coral text-white';
}

function Cell({ cell }: { cell: GradeCell | null }) {
  if (!cell) return <span className="text-ink-soft/50">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {cell.score === null ? (
        <span
          title="Илгээсэн, дүн ороогүй"
          className="rounded-full bg-ink/10 px-2 py-0.5 text-[12px] font-semibold text-ink-soft"
        >
          ✓
        </span>
      ) : (
        <span className={cx('rounded-full px-2 py-0.5 text-[12px] font-bold', scoreClass(cell.score))}>
          {cell.score}%
        </span>
      )}
      {cell.late && (
        <span title="Хоцорсон" className="text-[12px]">
          ⏱
        </span>
      )}
    </span>
  );
}

/** Members × assignments in one table (admins only), downloadable as CSV. */
export function GradesMatrix({ classId, groupName }: { classId: string; groupName: string }) {
  const toast = useToast();
  const [grades, setGrades] = useState<ClassGrades | null>(null);

  useEffect(() => {
    api
      .getGrades(classId)
      .then(setGrades)
      .catch((err: ApiError) =>
        toast(err.payload?.error || 'Дүнгийн хүснэгтийг ачаалж чадсангүй', 'error'),
      );
  }, [classId, toast]);

  if (!grades) return null;
  if (grades.students.length === 0 || grades.assignments.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-ink-soft">
        Гишүүн болон даалгавар нэмэгдсэний дараа нэгдсэн хүснэгт энд гарна.
      </p>
    );
  }

  function exportCsv() {
    if (!grades) return;
    const blob = new Blob([gradesCsv(grades)], { type: 'text/csv;charset=utf-8' });
    saveBlob(blob, `${safeFileName(groupName)} - дүн.csv`);
  }

  return (
    <>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-line px-3 py-1 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          <Download size={13} aria-hidden /> CSV татах
        </button>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[14px]">
          <thead>
            <tr>
              <th className="sticky left-0 border-b-2 border-line bg-paper-raised px-3 py-2.5 text-left text-[13px] text-ink-soft">
                Гишүүн
              </th>
              {grades.assignments.map((a) => (
                <th
                  key={a.id}
                  title={a.title}
                  className="max-w-36 truncate border-b-2 border-line px-3 py-2.5 text-left text-[13px] text-ink-soft"
                >
                  {a.title}
                </th>
              ))}
              <th className="border-b-2 border-line px-3 py-2.5 text-left text-[13px] text-ink-soft">
                Дундаж
              </th>
            </tr>
          </thead>
          <tbody>
            {grades.students.map((s) => (
              <tr key={s.id}>
                <td className="sticky left-0 border-b border-line bg-paper-raised px-3 py-2.5 font-medium text-ink">
                  {s.name}
                </td>
                {grades.assignments.map((a) => (
                  <td key={a.id} className="border-b border-line px-3 py-2.5">
                    <Cell cell={s.cells[a.id]} />
                  </td>
                ))}
                <td className="border-b border-line px-3 py-2.5 font-bold text-ink">
                  {s.average === null ? '—' : `${s.average}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-ink-soft">✓ илгээсэн, дүн ороогүй · ⏱ хоцорсон · — илгээгээгүй</p>
      </div>
    </>
  );
}
