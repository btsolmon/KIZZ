'use client';

import { Fragment, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { AttachmentLink } from '@/components/AttachmentLink';
import { api } from '@/lib/api';
import { avatarSrcFor } from '@/lib/avatar';
import { cx } from '@/lib/cx';
import { useToast } from '@/lib/toast';
import type { ApiError, ClassPeople, PersonSummary, Quiz, Submission } from '@/lib/types';
import { QuizReview } from './QuizReview';

function scoreClass(score: number) {
  if (score >= 80) return 'bg-mint';
  if (score >= 50) return 'bg-amber';
  return 'bg-coral text-white';
}

function GradeEntry({
  submission,
  onGraded,
  onCancel,
}: {
  submission: Submission;
  onGraded: (updated: Submission) => void;
  /** Present when correcting an existing grade. */
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState(submission.score === null ? '' : String(submission.score));
  const [saving, setSaving] = useState(false);

  async function save() {
    const score = Number(value);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      toast('Дүн 0-100 хооронд бүхэл тоо байх ёстой', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.gradeSubmission(submission.id, score);
      onGraded(updated);
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Дүн хадгалахад алдаа гарлаа', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0-100"
        className="w-20 rounded-sm border-2 border-line px-2 py-1 text-[13px]"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || value === ''}
        className="rounded-full bg-violet px-3 py-1 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        Хадгалах
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border-2 border-line px-3 py-1 text-[13px] font-semibold text-ink-soft hover:border-ink"
        >
          Болих
        </button>
      )}
    </div>
  );
}

/** What a member handed in: their quiz answers and/or attached file. */
function SubmissionDetail({ submission, quiz }: { submission: Submission; quiz: Quiz | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-paper p-3">
      {submission.materialId ? (
        <AttachmentLink materialId={submission.materialId} label="Илгээсэн файл татах" />
      ) : (
        !quiz && <p className="text-[13px] text-ink-soft">Файл хавсаргаагүй.</p>
      )}
      {quiz && (
        <QuizReview questions={quiz.questions} answers={submission.answers} />
      )}
    </div>
  );
}

/** Members who haven't handed the assignment in, with a reminder button. */
function MissingMembers({
  assignmentId,
  people,
  archived,
}: {
  assignmentId: string;
  people: PersonSummary[];
  archived: boolean;
}) {
  const toast = useToast();
  const [sending, setSending] = useState(false);

  async function remind() {
    setSending(true);
    try {
      const { reminded } = await api.remindAssignment(assignmentId);
      toast(
        reminded > 0
          ? `${reminded} гишүүнд сануулга илгээлээ`
          : 'Өнөөдөр аль хэдийн сануулсан байна',
      );
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Сануулга илгээж чадсангүй', 'error');
    } finally {
      setSending(false);
    }
  }

  if (people.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink-soft">Илгээгээгүй ({people.length})</p>
        {!archived && (
          <button
            type="button"
            onClick={remind}
            disabled={sending}
            title="Өнөөдөр нэг удаа сануулна"
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-line px-3 py-1 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            <BellRing size={13} aria-hidden /> Сануулах
          </button>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {people.map((p) => (
          <li
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-paper py-1 pl-1 pr-3 text-[13px] text-ink"
          >
            <img src={avatarSrcFor(p)} alt="" className="h-6 w-6 rounded-full object-cover" />
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Gradebook({
  assignmentId,
  classId,
  archived,
}: {
  assignmentId: string;
  classId: string;
  archived: boolean;
}) {
  const toast = useToast();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [people, setPeople] = useState<ClassPeople | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.listSubmissions(assignmentId),
      api.getAssignment(assignmentId),
      api.getPeople(classId),
    ])
      .then(([list, detail, members]) => {
        setSubmissions(list);
        setQuiz(detail.quiz);
        setPeople(members);
      })
      .catch((err: ApiError) => {
        toast(
          err.payload?.error || 'Дүнгийн самбарыг ачаалж чадсангүй',
          'error',
        );
      });
  }, [assignmentId, classId, toast]);

  if (submissions === null || people === null) return null;

  const handedIn = new Set(submissions.map((s) => s.studentId));
  const missing = (
    <MissingMembers
      assignmentId={assignmentId}
      people={people.students.filter((p) => !handedIn.has(p.id))}
      archived={archived}
    />
  );

  if (submissions.length === 0) {
    return (
      <>
        <p className="mt-3.5 text-ink-soft">Хараахан хэн ч илгээгээгүй байна.</p>
        {missing}
      </>
    );
  }

  const graded = submissions.filter(
    (s): s is Submission & { score: number } => s.score !== null,
  );
  const average =
    graded.length > 0
      ? Math.round(graded.reduce((sum, s) => sum + s.score, 0) / graded.length)
      : null;

  function handleGraded(updated: Submission) {
    setSubmissions((prev) =>
      prev ? prev.map((s) => (s.id === updated.id ? { ...s, ...updated, late: s.late } : s)) : prev,
    );
    setEditingId(null);
  }

  return (
    <>
      <p className="mt-3.5 text-[13px] font-semibold text-ink-soft">
        {submissions.length} гишүүн илгээсэн
        {average !== null && ` · Дундаж оноо: ${average}%`}
        {graded.length < submissions.length &&
          ` · ${submissions.length - graded.length} дүн ороогүй`}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b-2 border-line px-3 py-2.5 text-left text-[13px] text-ink-soft">
                Гишүүн
              </th>
              <th className="border-b-2 border-line px-3 py-2.5 text-left text-[13px] text-ink-soft">
                Дүн
              </th>
              <th className="border-b-2 border-line px-3 py-2.5 text-left text-[13px] text-ink-soft">
                Илгээсэн
              </th>
              <th className="border-b-2 border-line px-3 py-2.5">
                <span className="sr-only">Дэлгэрэнгүй</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => {
              const viewing = viewingId === s.id;
              return (
                <Fragment key={s.id}>
                  <tr>
                    <td className={cx('px-3 py-2.5', !viewing && 'border-b-2 border-line')}>
                      {s.studentName}
                    </td>
                    <td className={cx('px-3 py-2.5', !viewing && 'border-b-2 border-line')}>
                      {s.score === null || editingId === s.id ? (
                        <GradeEntry
                          submission={s}
                          onGraded={handleGraded}
                          onCancel={s.score === null ? undefined : () => setEditingId(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingId(s.id)}
                          title="Дүнг засах"
                          className={`inline-block rounded-full px-2.5 py-0.75 text-[13px] font-bold ${scoreClass(s.score)}`}
                        >
                          {s.score}%
                        </button>
                      )}
                    </td>
                    <td className={cx('px-3 py-2.5', !viewing && 'border-b-2 border-line')}>
                      {new Date(s.submittedAt).toLocaleString()}
                      {s.late && (
                        <span className="ml-2 rounded-full bg-coral/15 px-2 py-0.5 text-[12px] font-semibold text-coral">
                          Хоцорсон
                        </span>
                      )}
                    </td>
                    <td className={cx('px-3 py-2.5 text-right', !viewing && 'border-b-2 border-line')}>
                      <button
                        type="button"
                        onClick={() => setViewingId(viewing ? null : s.id)}
                        aria-expanded={viewing}
                        className="rounded-full border-2 border-line px-3 py-1 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
                      >
                        {viewing ? 'Хаах' : 'Харах'}
                      </button>
                    </td>
                  </tr>
                  {viewing && (
                    <tr>
                      <td colSpan={4} className="border-b-2 border-line px-3 pb-3">
                        <SubmissionDetail submission={s} quiz={quiz} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {missing}
    </>
  );
}
