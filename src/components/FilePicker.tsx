'use client';

import { useId } from 'react';
import { Paperclip, X } from 'lucide-react';
import { formatSize } from '@/lib/text';

/** File types a group file may have — mirrors ALLOWED_MATERIAL_TYPES in
 * src/lib/materials.ts. */
export const MATERIAL_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip';

/** Picks one optional file to send with a form: a pill button, or the
 * chosen file with a remove button. */
export function FilePicker({
  file,
  onChange,
  label = 'Файл хавсаргах',
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  label?: string;
}) {
  const inputId = useId();
  if (file) {
    return (
      <div className="flex min-w-0 items-center gap-2.5 self-start rounded-xl border border-line px-3 py-2">
        <Paperclip size={15} className="shrink-0 text-ink-soft" aria-hidden />
        <span className="min-w-0 truncate text-sm font-medium text-ink">{file.name}</span>
        <span className="shrink-0 text-xs text-ink-soft">{formatSize(file.size)}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Файлыг хасах"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-ink/5"
        >
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <label
      htmlFor={inputId}
      className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border-2 border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
    >
      <Paperclip size={14} aria-hidden />
      {label}
      <input
        id={inputId}
        type="file"
        accept={MATERIAL_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </label>
  );
}
