import { getDb } from '@/db/client';
import { classMaterials } from '@/db/schema';

// Kept well under common serverless request-body limits (Vercel's default
// is ~4.5MB) — base64 encoding adds about a third on top of this.
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

export const ALLOWED_MATERIAL_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
]);

// Columns to select everywhere except the single download route — list
// responses (and anything embedding a material summary, like an assignment)
// should never carry file bytes.
export const materialColumns = {
  id: classMaterials.id,
  classId: classMaterials.classId,
  uploadedBy: classMaterials.uploadedBy,
  fileName: classMaterials.fileName,
  mimeType: classMaterials.mimeType,
  sizeBytes: classMaterials.sizeBytes,
  isSubmission: classMaterials.isSubmission,
  createdAt: classMaterials.createdAt,
};

/** Strips parameters such as `;charset=utf-8` from a MIME type. */
export function normalizeMime(type: string): string {
  return type.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

export type MaterialValidationError = {
  error: string;
  status: number;
};

/** Validates a `File` pulled off a `FormData`. Returns an error to return
 * as-is, or `null` if the file is fine to store. */
export function validateMaterialFile(
  file: unknown,
): MaterialValidationError | null {
  if (!(file instanceof File)) {
    return { error: 'Файл сонгоно уу.', status: 400 };
  }
  if (file.size === 0) {
    return { error: 'Хоосон файл байршуулах боломжгүй.', status: 400 };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      error: `Файлын хэмжээ ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB-с хэтэрч болохгүй.`,
      status: 413,
    };
  }
  const mimeType = normalizeMime(file.type);
  if (!ALLOWED_MATERIAL_TYPES.has(mimeType)) {
    return { error: 'Энэ төрлийн файлыг дэмжихгүй байна.', status: 415 };
  }
  return null;
}

/** Stores an already-validated file as a class material and returns the row
 * (without file bytes — same shape as `materialColumns`). `isSubmission`
 * marks a member's own work, which stays out of the shared materials list. */
export async function insertMaterial(params: {
  classId: string;
  uploadedBy: string;
  file: File;
  isSubmission?: boolean;
}) {
  const { classId, uploadedBy, file, isSubmission = false } = params;
  const buffer = Buffer.from(await file.arrayBuffer());
  const [row] = await getDb()
    .insert(classMaterials)
    .values({
      classId,
      uploadedBy,
      fileName: file.name.slice(0, 255) || 'file',
      mimeType: normalizeMime(file.type),
      sizeBytes: file.size,
      data: buffer.toString('base64'),
      isSubmission,
    })
    .returning(materialColumns);
  return row;
}
