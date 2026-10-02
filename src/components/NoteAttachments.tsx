'use client';

import { useEffect, useId, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, UploadCloud, X } from 'lucide-react';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { useToast } from '@/lib/toast';
import { useConfirm } from '@/lib/confirm';
import { formatSize } from '@/lib/text';
import type { ApiError, NoteAttachment } from '@/lib/types';

/** Files attached to a note. Uploads immediately (no draft state) and lists
 * what's stored; auth is a bearer token so downloads go through fetch+Blob. */
export function NoteAttachments({ noteId }: { noteId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const inputId = useId();
  const [items, setItems] = useState<NoteAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listNoteAttachments(noteId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    for (const file of Array.from(list)) {
      try {
        const created = await api.uploadNoteAttachment(noteId, file);
        setItems((prev) => [...prev, created]);
      } catch (err) {
        toast(
          (err as ApiError).payload?.error || `${file.name} байршуулж чадсангүй`,
          'error',
        );
      }
    }
    setUploading(false);
  }

  async function download(item: NoteAttachment) {
    try {
      const { blob, fileName } = await api.downloadNoteAttachment(item.id);
      saveBlob(blob, fileName);
    } catch {
      toast('Татахад алдаа гарлаа', 'error');
    }
  }

  async function remove(item: NoteAttachment) {
    if (!(await confirm({ message: `"${item.fileName}" файлыг устгах уу?`, danger: true }))) return;
    try {
      await api.deleteNoteAttachment(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch {
      toast('Устгахад алдаа гарлаа', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink/15 p-5 text-center transition-colors hover:border-ink/30"
      >
        {uploading ? (
          <Loader2 size={22} className="animate-spin text-ink-soft" />
        ) : (
          <UploadCloud size={22} className="text-ink-soft" />
        )}
        <span className="text-sm font-semibold text-ink">
          Файл чирж оруулах, эсвэл дарж сонгох
        </span>
        <span className="text-xs text-ink-soft">PDF, JPG, PNG · 3MB хүртэл</span>
        <input
          id={inputId}
          type="file"
          accept=".pdf,image/png,image/jpeg,image/gif,image/webp"
          multiple
          disabled={uploading}
          className="sr-only"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2"
            >
              {f.mimeType === 'application/pdf' ? (
                <FileText size={16} className="shrink-0 text-ink-soft" />
              ) : (
                <ImageIcon size={16} className="shrink-0 text-ink-soft" />
              )}
              <button
                type="button"
                onClick={() => download(f)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-ink hover:underline">
                  {f.fileName}
                </p>
                <p className="text-xs text-ink-soft">{formatSize(f.sizeBytes)}</p>
              </button>
              <button
                type="button"
                onClick={() => remove(f)}
                aria-label={`${f.fileName} хасах`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-ink/5"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
