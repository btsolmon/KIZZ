'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Card, EmptyState, Field, TextInput } from '@/components/ui';
import { AttachmentLink } from '@/components/AttachmentLink';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useConfirm } from '@/lib/confirm';
import { dueInfo, dueInputValue } from '@/lib/dueDate';
import { cx } from '@/lib/cx';
import { AssignmentTaker } from './AssignmentTaker';
import { EditAssignmentDialog, dateTimeInputClass } from './EditAssignmentDialog';
import type { ApiError, Assignment, Quiz } from '@/lib/types';

const NO_QUIZ = '';
const MAX_DESCRIPTION = 2000;

export function ClassAssignments({
  classId,
  isTeacher,
  archived,
  assignments,
  onCreated,
}: {
  classId: string;
  isTeacher: boolean;
  archived: boolean;
  assignments: Assignment[];
  onCreated: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizId, setQuizId] = useState(NO_QUIZ);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openStudentAssignment, setOpenStudentAssignment] = useState<
    string | null
  >(null);

  // Only the group's own quizzes can be assigned — members can't open
  // anyone's personal ones.
  useEffect(() => {
    if (!isTeacher || !formOpen) return;
    api
      .listClassQuizzes(classId)
      .then(setQuizzes)
      .catch(() => setQuizzes([]));
  }, [isTeacher, formOpen, classId]);

  async function createAssignment() {
    if (!title.trim()) {
      toast('Даалгаврын нэрээ оруулна уу', 'error');
      return;
    }
    setCreating(true);
    try {
      await api.createAssignment(classId, {
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueInputValue(dueDate, dueTime),
        quizId: quizId || undefined,
        file,
      });
      toast('Даалгавар нэмэгдлээ');
      setTitle('');
      setDescription('');
      setDueDate('');
      setDueTime('');
      setQuizId(NO_QUIZ);
      setFile(null);
      setFormOpen(false);
      onCreated();
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Алдаа гарлаа', 'error');
    } finally {
      setCreating(false);
    }
  }

  const [editing, setEditing] = useState<Assignment | null>(null);

  async function deleteAssignment(a: Assignment) {
    const n = a.submissionCount ?? 0;
    const warn = n > 0 ? ` ${n} гишүүний илгээлт бас устна.` : '';
    if (!(await confirm({ message: `"${a.title}" даалгаврыг устгах уу?${warn}`, danger: true }))) return;
    try {
      await api.deleteAssignment(a.id);
      toast('Даалгавар устгагдлаа');
      onCreated();
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Устгахад алдаа гарлаа', 'error');
    }
  }

  return (
    <div>
      {editing && (
        <EditAssignmentDialog
          assignment={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onCreated();
          }}
        />
      )}
      {isTeacher && !archived && (
        <Button
          variant={formOpen ? 'ghost' : 'primary'}
          onClick={() => setFormOpen((v) => !v)}
          className="mb-5"
        >
          {formOpen ? (
            <>
              <X size={16} /> Хаах
            </>
          ) : (
            <>
              <Plus size={16} /> Даалгавар нэмэх
            </>
          )}
        </Button>
      )}

      {formOpen && !archived && (
        <Card className="mb-5 flex flex-col gap-3 rounded-lg">
          <Field label="Даалгаврын нэр*" className="mb-0">
            <TextInput
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ж: 3-р бүлгийн дасгал"
            />
          </Field>
          <Field label="Заавар (заавал биш)" className="mb-0">
            <textarea
              value={description}
              maxLength={MAX_DESCRIPTION}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ж: 45-р хуудасны 1-10 дасгалыг хийгээд зургийг нь хавсаргаарай"
              className="w-full resize-y rounded-sm border-2 border-line bg-transparent p-2.5 text-[15px] text-ink outline-none focus:border-violet"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <Field label="Хугацаа (заавал биш)" className="mb-0">
              <div className="flex gap-2">
                <input
                  type="date"
                  aria-label="Огноо"
                  className={dateTimeInputClass}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                <input
                  type="time"
                  aria-label="Цаг (заавал биш)"
                  title="Цаг сонгохгүй бол тухайн өдрийн 23:59 хүртэл"
                  className={cx(dateTimeInputClass, 'w-32 shrink-0')}
                  value={dueTime}
                  disabled={!dueDate}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
            </Field>
            <Field label="Quiz (заавал биш)" className="mb-0">
              <select
                className="w-full rounded-sm border-2 border-line p-2.5"
                value={quizId}
                onChange={(e) => setQuizId(e.target.value)}
              >
                <option value={NO_QUIZ}>
                  {quizzes.length === 0 ? 'Бүлэгт quiz алга' : 'Quiz сонгохгүй'}
                </option>
                {quizzes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Хавсралт файл (заавал биш)" className="mb-0">
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[14px]"
            />
          </Field>
          <Button
            variant="primary"
            onClick={createAssignment}
            disabled={creating}
            className="self-start"
          >
            {creating ? 'Нэмж байна...' : 'Өгөх'}
          </Button>
        </Card>
      )}

      <h3 className="mb-2.5 mt-6 text-lg">Даалгаврууд</h3>
      {assignments.length === 0 ? (
        <EmptyState title="Даалгавар алга">
          <p>
            {isTeacher
              ? 'Дээрх товчоор анхны даалгавраа өгөөрэй.'
              : 'Админ даалгавар өгмөгц энд харагдана.'}
          </p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {assignments.map((a) => {
            const due = dueInfo(a.dueAt);
            return isTeacher ? (
              <Card key={a.id} className="rounded-lg">
                <div className="flex flex-wrap items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-answer-1/15 text-answer-1">
                    <ClipboardList size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base">{a.title}</h3>
                    <p
                      className={cx(
                        'text-[13px]',
                        due.overdue ? 'text-coral' : 'text-ink-soft',
                      )}
                    >
                      {due.label}
                      {!a.quizId && ' · Quiz-гүй'}
                    </p>
                    {a.description && (
                      <p className="mt-1 line-clamp-2 whitespace-pre-line text-[13px] text-ink-soft">
                        {a.description}
                      </p>
                    )}
                  </div>
                  {a.materialId && (
                    <AttachmentLink
                      materialId={a.materialId}
                      className="shrink-0 rounded-full border-2 border-line px-3 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
                    />
                  )}
                  <span className="shrink-0 rounded-full bg-paper px-3 py-1.5 text-[13px] font-semibold text-ink-soft">
                    {a.submissionCount ?? 0} илгээсэн
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    aria-label={`${a.title} засах`}
                    title="Засах"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAssignment(a)}
                    aria-label={`${a.title} устгах`}
                    title="Устгах"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-coral/10 hover:text-coral"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </Card>
            ) : (
              <Card key={a.id} className="rounded-lg">
                <div className="flex flex-wrap items-center gap-3.5">
                  <div
                    className={cx(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                      a.mySubmission
                        ? 'bg-mint/15 text-mint'
                        : due.overdue
                          ? 'bg-coral/15 text-coral'
                          : 'bg-answer-1/15 text-answer-1',
                    )}
                  >
                    <ClipboardList size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base">{a.title}</h3>
                    <p
                      className={cx(
                        'text-[13px]',
                        due.overdue && !a.mySubmission
                          ? 'text-coral'
                          : 'text-ink-soft',
                      )}
                    >
                      {due.label}
                    </p>
                  </div>
                  {a.materialId && (
                    <AttachmentLink
                      materialId={a.materialId}
                      className="shrink-0 rounded-full border-2 border-line px-3 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
                    />
                  )}
                  <Button
                    variant={a.mySubmission ? 'mint' : 'primary'}
                    onClick={() =>
                      setOpenStudentAssignment(
                        openStudentAssignment === a.id ? null : a.id,
                      )
                    }
                  >
                    {a.mySubmission ? (
                      <>
                        <CheckCircle2 size={15} />{' '}
                        {a.mySubmission.score === null
                          ? 'Илгээсэн'
                          : `${a.mySubmission.score}%`}
                      </>
                    ) : (
                      'Нээх →'
                    )}
                  </Button>
                </div>
                {openStudentAssignment === a.id && (
                  <div className="mt-4">
                    <AssignmentTaker assignmentId={a.id} archived={archived} onSubmitted={onCreated} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
