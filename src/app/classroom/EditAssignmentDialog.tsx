'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { dueDateInput, dueInputValue, dueTimeInput } from '@/lib/dueDate';
import { useToast } from '@/lib/toast';
import type { ApiError, Assignment } from '@/lib/types';
import { Modal } from '@/components/Modal';

export const dateTimeInputClass =
  'w-full rounded-sm border-2 border-line bg-transparent p-2.5 text-ink';

export function EditAssignmentDialog({
  assignment,
  onClose,
  onSaved,
}: {
  assignment: Assignment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(assignment.title);
  const [description, setDescription] = useState(assignment.description ?? '');
  const [dueDate, setDueDate] = useState(dueDateInput(assignment.dueAt));
  const [dueTime, setDueTime] = useState(dueTimeInput(assignment.dueAt));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return toast('Даалгаврын нэрийг оруулна уу', 'error');
    setSaving(true);
    try {
      await api.updateAssignment(assignment.id, {
        title: title.trim(),
        description: description.trim() || null,
        dueAt: dueInputValue(dueDate, dueTime),
      });
      toast('Даалгавар шинэчлэгдлээ');
      onSaved();
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Хадгалахад алдаа гарлаа', 'error');
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} label="Даалгавар засах" className="max-w-md">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">Даалгавар засах</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-ink/5"
          >
            <X size={18} />
          </button>
        </div>
        <Field label="Нэр*" className="mt-4">
          <TextInput autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Заавар (заавал биш)">
          <textarea
            value={description}
            maxLength={2000}
            rows={4}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-y rounded-sm border-2 border-line bg-transparent p-2.5 text-[15px] text-ink outline-none focus:border-violet"
          />
        </Field>
        <Field label="Хугацаа (заавал биш)">
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
              className={cx(dateTimeInputClass, 'w-32 shrink-0')}
              value={dueTime}
              disabled={!dueDate}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
        </Field>
        <p className="text-xs text-ink-soft">
          Цаг сонгохгүй бол тухайн өдрийн 23:59 хүртэл. Хугацааг өөрчилвөл гишүүдэд мэдэгдэл очно.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Хадгалж байна...' : 'Хадгалах'}
          </Button>
        </div>
    </Modal>
  );
}
