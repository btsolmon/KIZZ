import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { assignments, classMaterials, quizzes, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { archivedGuard, getClassMembership } from '@/lib/access';
import { UNIQUE_VIOLATION, pgErrorCode } from '@/lib/dbErrors';
import { fileHasValidSignature } from '@/lib/fileSignature';
import { insertMaterial, validateMaterialFile } from '@/lib/materials';
import { classTeacherIds, notifyUsers } from '@/lib/notifications';
import { awardAssignmentCompletion } from '@/lib/points/awards';
import { rateLimit } from '@/lib/rateLimit';
import type { SubmitResult } from '@/lib/types';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ assignmentId: string }> };

/** The answers and optional file from either a JSON body (`{ answers }`) or
 * multipart form data (`answers` as a JSON string, plus `file`). */
async function readBody(
  request: Request,
): Promise<{ rawAnswers: unknown[]; file: File | null }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    let rawAnswers: unknown = [];
    try {
      rawAnswers = JSON.parse(String(form?.get('answers') ?? '[]'));
    } catch {
      rawAnswers = [];
    }
    const file = form?.get('file');
    return {
      rawAnswers: Array.isArray(rawAnswers) ? rawAnswers : [],
      // An empty file input still shows up as a 0-byte File in some browsers.
      file: file instanceof File && file.size > 0 ? file : null,
    };
  }
  const body = await request.json().catch(() => null);
  return { rawAnswers: Array.isArray(body?.answers) ? body.answers : [], file: null };
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const db = getDb();
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    return NextResponse.json(
      { error: 'Даалгавар олдсонгүй.' },
      { status: 404 },
    );
  }

  const { klass, isMember, isTeacher } = await getClassMembership(
    assignment.classId,
    auth.user.id,
  );
  if (!klass || !isMember) {
    return NextResponse.json(
      { error: 'Даалгавар олдсонгүй.' },
      { status: 404 },
    );
  }

  if (isTeacher) {
    return NextResponse.json(
      { error: 'Бүлгийн админ даалгавар илгээх боломжгүй.' },
      { status: 403 },
    );
  }
  const archived = archivedGuard(klass);
  if (archived) return archived;

  const { rawAnswers, file } = await readBody(request);

  // A quiz-less assignment has nothing to auto-score — "submitting" just
  // marks it turned in, with a null score until the teacher grades it
  // manually (see PATCH /submissions/:id).
  let answers: (number | null)[] = [];
  let correctCount: number | null = null;
  let totalQuestions = 0;
  let score: number | null = null;

  if (assignment.quizId) {
    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, assignment.quizId))
      .limit(1);
    if (!quiz) {
      return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
    }

    answers = quiz.questions.map((_, i) =>
      typeof rawAnswers[i] === 'number' ? (rawAnswers[i] as number) : null,
    );
    correctCount = quiz.questions.filter(
      (q, i) => answers[i] === q.correctIndex,
    ).length;
    totalQuestions = quiz.questions.length;
    score =
      totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100);
  }

  let reward: SubmitResult['reward'] = undefined;

  const [existing] = await db
    .select({ id: submissions.id, materialId: submissions.materialId })
    .from(submissions)
    .where(
      and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, auth.user.id)),
    )
    .limit(1);

  // Redoing it is fine until the deadline; after that the result is final.
  if (existing && assignment.dueAt && assignment.dueAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'Хугацаа дууссан тул дахин илгээх боломжгүй.' },
      { status: 409 },
    );
  }

  // The member's own work, optional either way. A new file replaces the one
  // sent before; without one, the earlier file stays.
  let materialId = existing?.materialId ?? null;
  if (file) {
    const invalid = validateMaterialFile(file);
    if (invalid) {
      return NextResponse.json({ error: invalid.error }, { status: invalid.status });
    }
    if (!(await fileHasValidSignature(file))) {
      return NextResponse.json(
        { error: 'Файлын агуулга төрөлтэйгээ таарахгүй байна.' },
        { status: 415 },
      );
    }
    const limited = rateLimit(`upload:${auth.user.id}`, 30, 10 * 60_000);
    if (limited) return limited;
    const material = await insertMaterial({
      classId: assignment.classId,
      uploadedBy: auth.user.id,
      file,
      isSubmission: true,
    });
    materialId = material.id;
  }

  if (existing) {
    await db
      .update(submissions)
      .set({ answers, score, materialId, submittedAt: new Date() })
      .where(eq(submissions.id, existing.id));
    if (existing.materialId && existing.materialId !== materialId) {
      await db.delete(classMaterials).where(eq(classMaterials.id, existing.materialId));
    }
  } else {
    try {
      await db.insert(submissions).values({
        assignmentId,
        studentId: auth.user.id,
        answers,
        score,
        materialId,
      });
    } catch (err) {
      if (materialId) {
        await db.delete(classMaterials).where(eq(classMaterials.id, materialId));
      }
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        return NextResponse.json(
          { error: 'Та энэ даалгаврыг өмнө нь илгээсэн байна.' },
          { status: 409 },
        );
      }
      throw err;
    }
  }

  // The first time a quiz is completed it earns XP (resubmitting doesn't).
  if (!existing && assignment.quizId && score !== null) {
    reward = (await awardAssignmentCompletion(auth.user.id, assignmentId, score)) ?? undefined;
  }

  // Without a quiz nothing is auto-graded, so tell the admins there is
  // something waiting for a grade.
  if (!assignment.quizId) {
    await notifyUsers(await classTeacherIds(assignment.classId), {
      title: `${auth.user.name} "${assignment.title}" даалгавар илгээлээ`,
      body: 'Дүн оруулахыг хүлээж байна',
      href: `/classroom?classId=${assignment.classId}&tab=marks`,
    });
  }

  const result: SubmitResult = { score, correctCount, totalQuestions, reward };
  return NextResponse.json(result, { status: existing ? 200 : 201 });
}
