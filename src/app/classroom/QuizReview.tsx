import { CircleCheck, CircleX } from 'lucide-react';
import { cx } from '@/lib/cx';
import type { QuizQuestion } from '@/lib/types';

/** Question-by-question look at a submitted quiz. Whether each answer was
 * right comes from `correct` (the server's verdict, for a viewer without
 * the answer key) or from the questions' `correctIndex`. The correct option
 * and its explanation are shown only when the questions carry them. */
export function QuizReview({
  questions,
  answers,
  correct,
}: {
  questions: QuizQuestion[];
  answers: (number | null)[];
  correct?: boolean[] | null;
}) {
  return (
    <ol className="flex flex-col gap-2.5">
      {questions.map((q, qi) => {
        const picked = answers[qi] ?? null;
        const right = correct ? !!correct[qi] : picked !== null && picked === q.correctIndex;
        return (
          <li
            key={q.id}
            className={cx(
              'rounded-xl border p-3',
              right ? 'border-mint/50 bg-mint/5' : 'border-coral/40 bg-coral/5',
            )}
          >
            <p className="flex items-start gap-2 font-semibold text-ink">
              {right ? (
                <CircleCheck size={18} className="mt-0.5 shrink-0 text-mint" aria-label="Зөв" />
              ) : (
                <CircleX size={18} className="mt-0.5 shrink-0 text-coral" aria-label="Буруу" />
              )}
              <span>
                {qi + 1}. {q.prompt}
              </span>
            </p>
            <ul className="mt-2 flex flex-col gap-1 pl-6.5 text-[14px]">
              {q.options.map((opt, oi) => {
                const isPicked = picked === oi;
                const isAnswer = oi === q.correctIndex;
                if (!isPicked && !isAnswer) {
                  return (
                    <li key={oi} className="text-ink-soft">
                      {opt}
                    </li>
                  );
                }
                return (
                  <li
                    key={oi}
                    className={cx(
                      'font-semibold',
                      isPicked && !right ? 'text-coral' : 'text-mint',
                    )}
                  >
                    {opt}
                    <span className="ml-1.5 text-[12px] font-normal text-ink-soft">
                      {isPicked ? '(сонгосон)' : '(зөв хариулт)'}
                    </span>
                  </li>
                );
              })}
              {picked === null && (
                <li className="text-[13px] italic text-coral">Хариулаагүй</li>
              )}
            </ul>
            {q.explanation && (
              <p className="mt-2 pl-6.5 text-[13px] text-ink-soft">{q.explanation}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
