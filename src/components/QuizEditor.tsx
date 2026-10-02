'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { Button, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { LETTERS } from '@/components/Stage';
import { cx } from '@/lib/cx';
import { useConfirm } from '@/lib/confirm';
import { useToast } from '@/lib/toast';
import type { ApiError, Question, Quiz } from '@/lib/types';
import { Modal } from '@/components/Modal';

const MAX_QUESTIONS = 50;

const blankQuestion = (): Question => ({
  id: crypto.randomUUID(),
  prompt: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  explanation: '',
});

/** Modal editor for a quiz's title and questions. */
export function QuizEditor({
  quiz,
  onClose,
  onSaved,
}: {
  quiz: Quiz;
  onClose: () => void;
  onSaved: (quiz: Quiz) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState(quiz.title);
  // Only managers edit, and they always get the answer key.
  const [questions, setQuestions] = useState<Question[]>(
    quiz.questions.map((q) => ({ ...q, correctIndex: q.correctIndex ?? 0, options: [...q.options] })),
  );
  const [saving, setSaving] = useState(false);
  const [initial] = useState(() => JSON.stringify({ title: quiz.title, questions: quiz.questions }));
  const dirty = JSON.stringify({ title, questions }) !== initial;

  /** Closing with unsaved edits asks first. */
  async function requestClose() {
    if (
      !dirty ||
      (await confirm({
        message: 'Хадгалаагүй өөрчлөлт устана. Хаах уу?',
        confirmLabel: 'Хаах',
        danger: true,
      }))
    ) {
      onClose();
    }
  }

  function update(i: number, patch: Partial<Question>) {
    setQuestions((prev) => prev.map((q, qi) => (qi === i ? { ...q, ...patch } : q)));
  }
  function setOption(i: number, oi: number, value: string) {
    setQuestions((prev) =>
      prev.map((q, qi) =>
        qi === i ? { ...q, options: q.options.map((o, k) => (k === oi ? value : o)) } : q,
      ),
    );
  }
  function move(i: number, dir: -1 | 1) {
    setQuestions((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function remove(i: number) {
    if (questions.length <= 1) return toast('Дор хаяж нэг асуулт үлдэх ёстой', 'error');
    setQuestions((prev) => prev.filter((_, qi) => qi !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await api.updateQuiz(quiz.id, { title, questions });
      toast('Quiz хадгалагдлаа');
      onSaved(saved);
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Хадгалахад алдаа гарлаа', 'error');
      setSaving(false);
    }
  }

  return (
    <Modal onClose={requestClose} label="Quiz засах" className="max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-ink">Quiz засах</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Хаах"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-ink/5"
          >
            <X size={18} />
          </button>
        </div>

        <Field label="Гарчиг" className="mt-4">
          <TextInput value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="mt-2 flex flex-col gap-4">
          {questions.map((q, i) => (
            <div key={q.id} className="rounded-2xl border border-line p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-ink">Асуулт {i + 1}</p>
                <div className="flex items-center gap-1">
                  <IconBtn label="Дээш" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={15} />
                  </IconBtn>
                  <IconBtn label="Доош" disabled={i === questions.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={15} />
                  </IconBtn>
                  <IconBtn label="Устгах" danger onClick={() => remove(i)}>
                    <Trash2 size={15} />
                  </IconBtn>
                </div>
              </div>

              <textarea
                value={q.prompt}
                maxLength={500}
                rows={2}
                onChange={(e) => update(i, { prompt: e.target.value })}
                placeholder="Асуултын текст"
                aria-label={`Асуулт ${i + 1}`}
                className="w-full resize-y rounded-sm border-2 border-line bg-transparent p-2.5 text-[15px] text-ink outline-none focus:border-violet"
              />

              <p className="mb-1.5 mt-3 text-xs font-semibold text-ink-soft">
                Сонголтууд (зөв хариултыг радио товчоор тэмдэглэ)
              </p>
              <div className="flex flex-col gap-2">
                {q.options.map((opt, oi) => (
                  <label key={oi} className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      checked={q.correctIndex === oi}
                      onChange={() => update(i, { correctIndex: oi })}
                      aria-label={`${LETTERS[oi]} зөв хариулт`}
                      className="h-4 w-4 accent-green-600"
                    />
                    <span
                      className={cx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                        ['bg-answer-1', 'bg-answer-2', 'bg-answer-3', 'bg-answer-4'][oi],
                      )}
                    >
                      {LETTERS[oi]}
                    </span>
                    <TextInput
                      value={opt}
                      maxLength={200}
                      onChange={(e) => setOption(i, oi, e.target.value)}
                      placeholder={`${LETTERS[oi]} сонголт`}
                      aria-label={`${LETTERS[oi]} сонголт`}
                      className={cx(q.correctIndex === oi && 'border-green-600')}
                    />
                  </label>
                ))}
              </div>

              <TextInput
                value={q.explanation ?? ''}
                maxLength={500}
                onChange={(e) => update(i, { explanation: e.target.value })}
                placeholder="Тайлбар (заавал биш)"
                aria-label="Тайлбар"
                className="mt-3"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={questions.length >= MAX_QUESTIONS}
          onClick={() => setQuestions((prev) => [...prev, blankQuestion()])}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border-2 border-dashed border-line px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-50"
        >
          <Plus size={15} /> Асуулт нэмэх
        </button>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={requestClose}>
            Болих
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Хадгалж байна...' : 'Хадгалах'}
          </Button>
        </div>
    </Modal>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors disabled:opacity-30',
        danger ? 'hover:bg-coral/10 hover:text-coral' : 'hover:bg-ink/5 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
