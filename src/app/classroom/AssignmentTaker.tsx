'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { AttachmentLink } from '@/components/AttachmentLink';
import { FilePicker } from '@/components/FilePicker';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { dueInfo } from '@/lib/dueDate';
import { refreshNotifications } from '@/lib/events';
import type { ApiError, AssignmentDetail, SubmitResult } from '@/lib/types';
import { QuizReview } from './QuizReview';

export function AssignmentTaker({
  assignmentId,
  archived,
  onSubmitted,
}: {
  assignmentId: string;
  archived: boolean;
  /** Called after a successful submission so the list can refresh. */
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const a = await api.getAssignment(assignmentId);
    setAssignment(a);
    setAnswers(new Array(a.quiz?.questions.length ?? 0).fill(null));
  }, [assignmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err: ApiError) =>
      toast(err.payload?.error || 'Даалгаврыг ачаалж чадсангүй', 'error'),
    );
  }, [load, toast]);

  if (!assignment) return null;

  const { overdue } = dueInfo(assignment.dueAt);
  const submission = assignment.mySubmission;

  const instructions = (
    <>
      {assignment.description && (
        <p className="whitespace-pre-line break-words rounded-xl bg-paper p-3 text-[15px] leading-relaxed text-ink">
          {assignment.description}
        </p>
      )}
      {assignment.materialId && <AttachmentLink materialId={assignment.materialId} />}
    </>
  );

  async function submit() {
    setSubmitting(true);
    try {
      const r = await api.submitAssignment(assignmentId, { answers, file });
      setResult(r);
      setFile(null);
      setRetaking(false);
      if (r.reward) refreshNotifications();
      await load();
      onSubmitted();
    } catch (err) {
      toast(
        (err as ApiError).payload?.error || 'Илгээхэд алдаа гарлаа',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submission && !retaking) {
    return (
      <div className="flex flex-col gap-3">
        {instructions}
        <div>
          <p className="font-bold text-violet">
            {submission.score === null
              ? 'Та энэ даалгаврыг илгээсэн байна. Админ дүн оруулахыг хүлээж байна.'
              : `Таны дүн: ${submission.score}%`}
            {result?.reward && (
              <span className="ml-2 text-mint">
                +{result.reward.xp} XP
                {result.reward.coins > 0 && `, +${result.reward.coins} coin`}
              </span>
            )}
          </p>
          <p className="text-[13px] text-ink-soft">
            Илгээсэн: {new Date(submission.submittedAt).toLocaleString()}
          </p>
        </div>
        {submission.materialId && (
          <AttachmentLink materialId={submission.materialId} label="Миний илгээсэн файл" />
        )}

        {assignment.quiz && (
          <details open={!!result}>
            <summary className="cursor-pointer text-[14px] font-semibold text-ink-soft hover:text-ink">
              Хариултаа харах
            </summary>
            <div className="mt-3">
              <QuizReview
                questions={assignment.quiz.questions}
                answers={submission.answers}
                correct={assignment.myCorrect}
              />
              {assignment.quiz.answersHidden && (
                <p className="mt-2 text-[13px] text-ink-soft">
                  {overdue
                    ? 'Энэ quiz өөр нээлттэй даалгаварт ашиглагдаж байгаа тул зөв хариултууд одоохондоо харагдахгүй.'
                    : assignment.dueAt
                      ? 'Зөв хариултууд хугацаа дууссаны дараа харагдана. Түүнээс өмнө алдсан асуултаа засаад дахин илгээж болно.'
                      : 'Алдсан асуултаа засаад дахин илгээж болно.'}
                </p>
              )}
            </div>
          </details>
        )}

        {archived ? (
          <p className="text-[13px] text-ink-soft">
            Бүлэг архивлагдсан тул дахин илгээх боломжгүй.
          </p>
        ) : overdue ? (
          <p className="text-[13px] text-ink-soft">
            Хугацаа дууссан тул дахин илгээх боломжгүй.
          </p>
        ) : (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => {
              // Start from the previous answers so only the misses need fixing.
              setAnswers(
                assignment.quiz?.questions.map((_, i) => submission.answers[i] ?? null) ?? [],
              );
              setResult(null);
              setRetaking(true);
            }}
          >
            Дахин илгээх
          </Button>
        )}
      </div>
    );
  }

  if (archived) {
    return (
      <div className="flex flex-col gap-3">
        {instructions}
        <p className="text-[13px] text-ink-soft">
          Бүлэг архивлагдсан тул илгээх боломжгүй.
        </p>
      </div>
    );
  }

  const filePicker = (
    <FilePicker
      file={file}
      onChange={setFile}
      label={submission?.materialId ? 'Өөр файл хавсаргах' : 'Файл хавсаргах (заавал биш)'}
    />
  );

  if (!assignment.quiz) {
    // No quiz attached — a plain instructional item. Nothing to answer,
    // just the member's optional file and a "mark as done" action.
    return (
      <div className="flex flex-col gap-3">
        {instructions}
        {filePicker}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={submit} disabled={submitting} className="self-start">
            {submitting ? 'Илгээж байна...' : file ? 'Илгээх' : 'Дуусгасан гэж тэмдэглэх'}
          </Button>
          {retaking && (
            <Button variant="ghost" onClick={() => setRetaking(false)}>
              Болих
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {instructions}
      {assignment.quiz.questions.map((q, qi) => (
        <div key={q.id} className="rounded-xl border border-line p-3">
          <p className="mb-2 font-semibold">
            {qi + 1}. {q.prompt}
          </p>
          <div className="flex flex-col gap-2">
            {q.options.map((opt, oi) => (
              <label
                key={oi}
                className="flex cursor-pointer items-center gap-3"
              >
                <input
                  type="radio"
                  name={`${assignmentId}-q${qi}`}
                  checked={answers[qi] === oi}
                  onChange={() =>
                    setAnswers((prev) =>
                      prev.map((v, i) => (i === qi ? oi : v)),
                    )
                  }
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {filePicker}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-soft">
          {answers.filter((a) => a !== null).length} / {answers.length}{' '}
          асуулт бөглөсөн
        </p>
        <div className="flex gap-2">
          {retaking && (
            <Button variant="ghost" onClick={() => setRetaking(false)}>
              Болих
            </Button>
          )}
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Илгээж байна...' : 'Илгээх'}
          </Button>
        </div>
      </div>
    </div>
  );
}
