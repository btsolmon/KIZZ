'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, RotateCcw, Shuffle } from 'lucide-react';
import { Button } from './ui';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import type { ApiError, Quiz, QuizCheckResult, QuizQuestion } from '../lib/types';

const LETTERS = ['A', 'B', 'C', 'D'];
const LETTER_BG = ['bg-answer-1', 'bg-answer-2', 'bg-answer-3', 'bg-answer-4'];

interface PracticeStats {
  best: number; // best score, 0-100
  attempts: number;
  last: number;
}

// Practice results stay on this device (no server, no rewards — see below).
const statsKey = (quizId: string) => `kizz.practice.${quizId}`;

function readStats(quizId: string): PracticeStats | null {
  try {
    const raw = localStorage.getItem(statsKey(quizId));
    return raw ? (JSON.parse(raw) as PracticeStats) : null;
  } catch {
    return null;
  }
}

function recordAttempt(quizId: string, score: number): PracticeStats {
  const prev = readStats(quizId);
  const next: PracticeStats = {
    best: Math.max(prev?.best ?? 0, score),
    attempts: (prev?.attempts ?? 0) + 1,
    last: score,
  };
  try {
    localStorage.setItem(statsKey(quizId), JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, ...): practice still works.
  }
  return next;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Solo practice for a quiz: answer on your own, check, see what you got wrong
 * with the explanations, then retry just the misses or reshuffle the lot.
 * Deliberately earns no coins or XP — rewards here could be farmed. A group's
 * members don't hold the answer key, so their answers are checked by the
 * server, which keeps the correct ones back while an open assignment uses the
 * quiz. Your best score is kept on this device.
 */
export function QuizPlayer({ quiz, onBack }: { quiz: Quiz; onBack: () => void }) {
  const toast = useToast();
  const [questions, setQuestions] = useState<QuizQuestion[]>(quiz.questions);
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.questions.map(() => null));
  // Keyed by question id; null until this round is checked.
  const [results, setResults] = useState<Map<string, QuizCheckResult> | null>(null);
  const [checking, setChecking] = useState(false);
  const [stats, setStats] = useState<PracticeStats | null>(null);
  const [round, setRound] = useState(1);

  const submitted = results !== null;
  const fullRound = questions.length === quiz.questions.length;
  const wrong = useMemo(
    () => (results ? questions.filter((q) => !results.get(q.id)?.correct) : []),
    [questions, results],
  );
  const correct = questions.length - wrong.length;
  const percent = Math.round((correct / Math.max(1, questions.length)) * 100);
  const answered = answers.filter((a) => a !== null).length;
  // Checked by the server but no answer key came back: an open assignment uses it.
  const keyWithheld = !!results && [...results.values()].some((r) => r.correctIndex === undefined);

  function start(next: QuizQuestion[]) {
    setQuestions(next);
    setAnswers(next.map(() => null));
    setResults(null);
    setRound((r) => r + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function check() {
    const picks = questions.map((q, i) => ({ questionId: q.id, optionIndex: answers[i] }));
    let list: QuizCheckResult[];
    if (quiz.answersHidden) {
      setChecking(true);
      try {
        list = (await api.checkQuiz(quiz.id, picks)).results;
      } catch (err) {
        toast((err as ApiError).payload?.error || 'Шалгахад алдаа гарлаа', 'error');
        return;
      } finally {
        setChecking(false);
      }
    } else {
      list = questions.map((q, i) => ({
        questionId: q.id,
        correct: answers[i] === q.correctIndex,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      }));
    }
    const checked = new Map(list.map((r) => [r.questionId, r]));
    setResults(checked);
    // Only a full pass counts towards your stats, not a retry of the misses.
    if (fullRound) {
      const right = questions.filter((q) => checked.get(q.id)?.correct).length;
      setStats(recordAttempt(quiz.id, Math.round((right / Math.max(1, questions.length)) * 100)));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Бүх quiz
      </button>

      <div>
        <h3 className="text-lg">{quiz.title}</h3>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Ганцаараа дасгал · {fullRound ? `${questions.length} асуулт` : `${questions.length} буруу хариулсан асуултыг давтаж байна`}
        </p>
      </div>

      <div className="flex flex-col gap-3" key={round}>
        {questions.map((q, qi) => {
          const picked = answers[qi];
          const result = results?.get(q.id);
          return (
            <fieldset key={q.id} className="rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-ink-soft">Асуулт {qi + 1}</legend>
              <p className="mb-2 font-semibold">{q.prompt}</p>
              <div className="flex flex-col gap-2">
                {q.options.map((opt, oi) => {
                  const isPicked = picked === oi;
                  const isAnswerKey =
                    submitted && (result?.correctIndex === oi || (isPicked && !!result?.correct));
                  const isWrongPick = submitted && isPicked && !result?.correct;
                  return (
                    <label
                      key={oi}
                      className={`flex items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors ${
                        submitted ? 'cursor-default' : 'cursor-pointer hover:border-ink/30'
                      } ${isPicked && !submitted ? 'border-violet bg-violet/10' : 'border-line'} ${
                        isAnswerKey ? '!border-green-600 bg-green-500/10' : ''
                      } ${isWrongPick ? '!border-coral bg-coral/10' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`q${qi}`}
                        className="sr-only"
                        disabled={submitted}
                        checked={isPicked}
                        onChange={() =>
                          setAnswers((prev) => prev.map((v, i) => (i === qi ? oi : v)))
                        }
                      />
                      <span
                        aria-hidden
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${LETTER_BG[oi]}`}
                      >
                        {LETTERS[oi]}
                      </span>
                      <span className="flex-1">{opt}</span>
                      {isAnswerKey && <span className="text-sm font-semibold text-green-600">✓ Зөв</span>}
                      {isWrongPick && <span className="text-sm font-semibold text-coral">✗</span>}
                    </label>
                  );
                })}
              </div>
              {result?.explanation && (
                <p className="mt-2 rounded-lg bg-ink/5 px-3 py-2 text-[13px] text-ink-soft">
                  💡 {result.explanation}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>

      {submitted ? (
        <div className="rounded-2xl border-2 border-violet bg-violet/10 p-5 text-center">
          <p className="font-display text-4xl text-ink">
            {correct} / {questions.length}
          </p>
          <p className="mt-1 text-sm font-semibold text-ink-soft">
            {percent}% зөв ·{' '}
            {percent === 100 ? 'Төгс! 🎉' : percent >= 70 ? 'Сайн байна! 👍' : 'Дахин давтаад үзээрэй 💪'}
          </p>
          {keyWithheld && (
            <p className="mt-2 text-[13px] text-ink-soft">
              Энэ quiz нээлттэй даалгаварт ашиглагдаж байгаа тул зөв хариултууд одоохондоо харагдахгүй.
            </p>
          )}
          {fullRound && stats && (
            <p className="mt-2 text-[13px] text-ink-soft">
              Хамгийн сайн дүн: <span className="font-bold text-ink">{stats.best}%</span> · Оролдлого:{' '}
              <span className="font-bold text-ink">{stats.attempts}</span>
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {wrong.length > 0 && (
              <Button variant="primary" onClick={() => start(shuffled(wrong))}>
                <RotateCcw size={15} /> Буруугаа давтах ({wrong.length})
              </Button>
            )}
            <Button variant={wrong.length > 0 ? 'ghost' : 'primary'} onClick={() => start(shuffled(quiz.questions))}>
              <Shuffle size={15} /> Дахин эхлэх (холих)
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-soft">Дасгалын дүнд coin, XP олгогдохгүй.</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-soft">
            {answered} / {answers.length} асуулт бөглөсөн
          </p>
          <Button variant="primary" onClick={check} disabled={answered < answers.length || checking}>
            {checking ? 'Шалгаж байна...' : 'Шалгах'}
          </Button>
        </div>
      )}
    </div>
  );
}
