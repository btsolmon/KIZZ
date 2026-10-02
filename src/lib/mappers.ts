import type {
  AssignmentRow,
  ClassMaterialRow,
  ClassRow,
  GameSessionRow,
  GroupRow,
  NoteAttachmentRow,
  NoteRow,
  QuizRow,
  SubmissionRow,
} from '@/db/schema';
import type {
  Assignment,
  Class,
  GameSession,
  Group,
  Material,
  Note,
  NoteAttachment,
  Quiz,
  Submission,
} from '@/lib/types';

// Maps database rows (Date objects, DB-only fields) to the wire types the
// frontend expects (ISO strings, joined display fields). Keeps that
// translation in one place instead of repeating it in every route.

export const toGroup = (row: GroupRow): Group => ({
  id: row.id,
  name: row.name,
  code: row.code,
  createdAt: row.createdAt.toISOString(),
});

export const toNote = (row: NoteRow, updatedByName?: string): Note => ({
  id: row.id,
  groupId: row.groupId,
  classId: row.classId,
  title: row.title,
  content: row.content,
  updatedAt: row.updatedAt.toISOString(),
  updatedBy: row.updatedBy,
  updatedByName,
});

export const toQuiz = (row: QuizRow): Quiz => ({
  id: row.id,
  groupId: row.groupId,
  classId: row.classId,
  sourceNoteId: row.sourceNoteId,
  ownerId: row.ownerId,
  isPublic: row.isPublic,
  copyCount: row.copyCount,
  title: row.title,
  questions: row.questions,
  generatedBy: row.generatedBy,
  createdAt: row.createdAt.toISOString(),
});

export const toGameSession = (row: GameSessionRow): GameSession => ({
  id: row.id,
  code: row.code,
});

export const toClass = (
  row: ClassRow,
  teacherName: string,
  extra?: {
    memberCount?: number;
    canManage?: boolean;
  },
): Class => ({
  id: row.id,
  name: row.name,
  code: row.code,
  teacherId: row.teacherId,
  teacherName,
  color: row.color,
  description: row.description,
  archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
  memberCount: extra?.memberCount,
  canManage: extra?.canManage,
});

/** `row` must omit the `data` column (see the materials routes) — list
 * responses never carry file bytes, only the download endpoint does. */
export const toMaterial = (
  row: Omit<ClassMaterialRow, 'data'>,
): Material => ({
  id: row.id,
  classId: row.classId,
  uploadedBy: row.uploadedBy,
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt.toISOString(),
});

export const toNoteAttachment = (
  row: Omit<NoteAttachmentRow, 'data'>,
): NoteAttachment => ({
  id: row.id,
  noteId: row.noteId,
  uploadedBy: row.uploadedBy,
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt.toISOString(),
});

export const toAssignment = (
  row: AssignmentRow,
  extra?: {
    mySubmission?: Assignment['mySubmission'];
    submissionCount?: number;
  },
): Assignment => ({
  id: row.id,
  classId: row.classId,
  quizId: row.quizId,
  materialId: row.materialId,
  title: row.title,
  description: row.description,
  dueAt: row.dueAt ? row.dueAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
  mySubmission: extra?.mySubmission,
  submissionCount: extra?.submissionCount,
});

export const toSubmission = (
  row: SubmissionRow,
  studentName: string,
): Submission => ({
  id: row.id,
  assignmentId: row.assignmentId,
  studentId: row.studentId,
  studentName,
  answers: row.answers,
  score: row.score,
  materialId: row.materialId,
  submittedAt: row.submittedAt.toISOString(),
});
