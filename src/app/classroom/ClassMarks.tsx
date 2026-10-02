'use client';

import { useState } from 'react';
import { Button, Card, EmptyState } from '@/components/ui';
import { Gradebook } from './Gradebook';
import { GradesMatrix } from './GradesMatrix';
import type { Assignment } from '@/lib/types';

export function ClassMarks({
  classId,
  groupName,
  archived,
  assignments,
  isTeacher,
}: {
  classId: string;
  groupName: string;
  archived: boolean;
  assignments: Assignment[];
  isTeacher: boolean;
}) {
  const [openGradebook, setOpenGradebook] = useState<string | null>(null);
  const mine = assignments
    .map((a) => a.mySubmission?.score)
    .filter((s): s is number => typeof s === 'number');
  const average = mine.length
    ? Math.round(mine.reduce((sum, s) => sum + s, 0) / mine.length)
    : null;

  return (
    <div>
      <h3 className="mb-2.5 text-lg">Дүн</h3>
      {assignments.length === 0 ? (
        <EmptyState title="Даалгавар алга">
          <p>Даалгавар нэмэгдэхэд дүн энд харагдана.</p>
        </EmptyState>
      ) : isTeacher ? (
        <div className="flex flex-col gap-3">
          <Card className="rounded-lg">
            <h3 className="text-base">Нэгдсэн хүснэгт</h3>
            <GradesMatrix classId={classId} groupName={groupName} />
          </Card>
          <h3 className="mt-2 text-base">Даалгавар бүрээр</h3>
          {assignments.map((a) => (
            <Card key={a.id} className="rounded-lg">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base">{a.title}</h3>
                  <p className="text-[13px] text-ink-soft">
                    {a.submissionCount ?? 0} илгээсэн
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setOpenGradebook(openGradebook === a.id ? null : a.id)
                  }
                >
                  {openGradebook === a.id ? 'Хаах' : 'Дүнгийн самбар'}
                </Button>
              </div>
              {openGradebook === a.id && (
                <Gradebook assignmentId={a.id} classId={classId} archived={archived} />
              )}
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {average !== null && (
            <p className="mb-1 text-[14px] font-semibold text-ink-soft">
              Миний дундаж дүн: <span className="text-ink">{average}%</span>
            </p>
          )}
          {assignments.map((a) => (
            <Card
              key={a.id}
              className="flex items-center justify-between rounded-lg py-3.5"
            >
              <p className="truncate font-medium text-ink">{a.title}</p>
              {a.mySubmission ? (
                a.mySubmission.score === null ? (
                  <span className="shrink-0 rounded-full bg-paper px-3 py-1 text-[13px] font-semibold text-ink-soft">
                    Дүн ороогүй
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-mint px-3 py-1 text-[13px] font-semibold text-white">
                    {a.mySubmission.score}%
                  </span>
                )
              ) : (
                <span className="shrink-0 text-[13px] text-ink-soft">
                  Дүн алга
                </span>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
