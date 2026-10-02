'use client';

import { Paperclip } from 'lucide-react';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { useToast } from '@/lib/toast';

/** Downloads a class material by id. Auth here is a bearer token rather
 * than a cookie, so a plain `<a href>` can't be used for this; fetch as a
 * Blob and trigger a synthetic download. */
export async function downloadMaterial(materialId: string) {
  const { blob, fileName } = await api.downloadMaterial(materialId);
  saveBlob(blob, fileName);
}

/** Download button for a class material — used wherever an assignment or a
 * submission has an attached file. */
export function AttachmentLink({
  materialId,
  className,
  label = 'Хавсралт татах',
}: {
  materialId: string;
  className?: string;
  label?: string;
}) {
  const toast = useToast();

  async function download(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await downloadMaterial(materialId);
    } catch {
      toast('Татахад алдаа гарлаа', 'error');
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      className={
        className ??
        'inline-flex items-center gap-1.5 text-[14px] font-semibold text-violet hover:underline'
      }
    >
      <Paperclip size={15} /> {label}
    </button>
  );
}
