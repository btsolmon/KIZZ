'use client';

import { useEffect, useId, useState } from 'react';
import {
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { EmptyState, SkeletonList } from '@/components/ui';
import { downloadMaterial } from '@/components/AttachmentLink';
import { MATERIAL_ACCEPT } from '@/components/FilePicker';
import { api } from '@/lib/api';
import { useConfirm } from '@/lib/confirm';
import { formatSize } from '@/lib/text';
import { useToast } from '@/lib/toast';
import type { ApiError, Material } from '@/lib/types';

function FileIcon({ mimeType }: { mimeType: string }) {
  const props = { size: 18, className: 'shrink-0', 'aria-hidden': true } as const;
  if (mimeType.startsWith('image/')) return <FileImage {...props} />;
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
    return <Presentation {...props} />;
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return <FileSpreadsheet {...props} />;
  if (mimeType === 'application/zip') return <FileArchive {...props} />;
  return <FileText {...props} />;
}

/** Files the admins share with the whole group. Members can download them. */
export function ClassMaterials({
  classId,
  isTeacher,
  archived,
}: {
  classId: string;
  isTeacher: boolean;
  archived: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const inputId = useId();
  const [items, setItems] = useState<Material[] | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listMaterials(classId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        toast(err.payload?.error || 'Материалыг ачаалж чадсангүй', 'error');
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, toast]);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    for (const file of Array.from(list)) {
      try {
        const created = await api.uploadMaterial(classId, file);
        setItems((prev) => [created, ...(prev ?? [])]);
      } catch (err) {
        toast((err as ApiError).payload?.error || `${file.name} байршуулж чадсангүй`, 'error');
      }
    }
    setUploading(false);
  }

  async function download(item: Material) {
    try {
      await downloadMaterial(item.id);
    } catch {
      toast('Татахад алдаа гарлаа', 'error');
    }
  }

  async function remove(item: Material) {
    if (
      !(await confirm({
        message: `"${item.fileName}" файлыг устгах уу? Даалгаварт хавсаргасан бол тэндээс бас хасагдана.`,
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteMaterial(item.id);
      setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
      toast('Файл устгагдлаа');
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Устгахад алдаа гарлаа', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isTeacher && !archived && (
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink/15 p-6 text-center transition-colors hover:border-ink/30"
        >
          {uploading ? (
            <Loader2 size={22} className="animate-spin text-ink-soft" />
          ) : (
            <UploadCloud size={22} className="text-ink-soft" />
          )}
          <span className="text-sm font-semibold text-ink">
            Гишүүдтэйгээ хуваалцах файлаа сонгоно уу
          </span>
          <span className="text-xs text-ink-soft">
            PDF, зураг, Word, PowerPoint, Excel, ZIP · 3MB хүртэл
          </span>
          <input
            id={inputId}
            type="file"
            accept={MATERIAL_ACCEPT}
            multiple
            disabled={uploading}
            className="sr-only"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      )}

      <div>
        <h3 className="mb-2.5 text-lg">Материал</h3>
        {items === null ? (
          <SkeletonList rows={2} />
        ) : items.length === 0 ? (
          <EmptyState title="Материал алга">
            <p>
              {isTeacher
                ? 'Дээрээс файл байршуулахад гишүүд энд татаж авна.'
                : 'Админ файл хуваалцмагц энд харагдана.'}
            </p>
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-paper-raised px-4 py-3 shadow-sm"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet/15 text-violet">
                  <FileIcon mimeType={f.mimeType} />
                </span>
                <button
                  type="button"
                  onClick={() => download(f)}
                  className="min-w-0 flex-1 text-left"
                  title="Татах"
                >
                  <p className="truncate text-[15px] font-medium text-ink hover:underline">
                    {f.fileName}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {formatSize(f.sizeBytes)} ·{' '}
                    {new Date(f.createdAt).toLocaleDateString('mn-MN', {
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </button>
                {isTeacher && (
                  <button
                    type="button"
                    onClick={() => remove(f)}
                    aria-label={`${f.fileName} устгах`}
                    title="Устгах"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-coral/10 hover:text-coral"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
