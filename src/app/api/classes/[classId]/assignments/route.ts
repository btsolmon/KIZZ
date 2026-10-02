import { NextResponse } from 'next/server';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { assignments, quizzes, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { archivedGuard, canAccessQuiz, getClassMembership } from '@/lib/access';
import { toAssignment } from '@/lib/mappers';
import { classStudentIds, notifyUsers } from '@/lib/notifications';
import { fileHasValidSignature } from '@/lib/fileSignature';
import { formatDue, parseDueInput } from '@/lib/dueDate';
import { insertMaterial, validateMaterialFile } from '@/lib/materials';
import { optionalText } from '@/lib/text';
import { isUuid } from '@/lib/uuid';

const MAX_ASSIGNMENT_DESCRIPTION = 2000;

type Params = { params: Promise<{ classId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass, isMember, isTeacher } = await getClassMembership(
    classId,
    auth.user.id,
  );
  if (!klass || !isMember) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.classId, classId))
    .orderBy(desc(assignments.createdAt));

  if (rows.length === 0) return NextResponse.json([]);
  const assignmentIds = rows.map((r) => r.id);

  // Teachers see how many students have turned each assignment in; students
  // see their own result — enough to render a "Done"/"Missing" style badge
  // per assignment without opening each one.
  if (isTeacher) {
    const counts = await db
      .select({ assignmentId: submissions.assignmentId, value: count() })
      .from(submissions)
      .where(inArray(submissions.assignmentId, assignmentIds))
      .groupBy(submissions.assignmentId);
    const countByAssignment = new Map(counts.map((c) => [c.assignmentId, c.value]));
    return NextResponse.json(
      rows.map((row) =>
        toAssignment(row, {
          submissionCount: countByAssignment.get(row.id) ?? 0,
        }),
      ),
    );
  }

  const mine = await db
    .select()
    .from(submissions)
    .where(
      and(
        inArray(submissions.assignmentId, assignmentIds),
        eq(submissions.studentId, auth.user.id),
      ),
    );
  const mineByAssignment = new Map(mine.map((s) => [s.assignmentId, s]));
  return NextResponse.json(
    rows.map((row) => {
      const sub = mineByAssignment.get(row.id);
      return toAssignment(row, {
        mySubmission: sub
          ? { score: sub.score, submittedAt: sub.submittedAt.toISOString() }
          : null,
      });
    }),
  );
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass, isTeacher } = await getClassMembership(classId, auth.user.id);
  if (!klass) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }
  if (!isTeacher) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийн админ даалгавар өгөх боломжтой.' },
      { status: 403 },
    );
  }
  const archived = archivedGuard(klass);
  if (archived) return archived;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }
  const titleField = formData.get('title');
  const title =
    typeof titleField === 'string' && titleField.trim()
      ? titleField.trim()
      : 'Даалгавар';
  const description = optionalText(formData.get('description'));
  if (description && description.length > MAX_ASSIGNMENT_DESCRIPTION) {
    return NextResponse.json(
      { error: `Заавар ${MAX_ASSIGNMENT_DESCRIPTION} тэмдэгтээс ихгүй байх ёстой.` },
      { status: 400 },
    );
  }
  const dueAtField = formData.get('dueAt');
  const dueAt = parseDueInput(dueAtField);
  if (dueAt === undefined) {
    return NextResponse.json({ error: 'Хугацаа буруу байна.' }, { status: 400 });
  }
  const quizIdField = formData.get('quizId');
  const quizId = typeof quizIdField === 'string' && quizIdField ? quizIdField : null;

  const db = getDb();

  // The quiz is optional — an assignment can be a plain instructional item
  // with no auto-graded quiz attached. When one IS given, it must belong to
  // a group the teacher is actually in.
  if (quizId) {
    const [quiz] = await db
      .select({
        id: quizzes.id,
        groupId: quizzes.groupId,
        classId: quizzes.classId,
        ownerId: quizzes.ownerId,
      })
      .from(quizzes)
      .where(eq(quizzes.id, quizId))
      .limit(1);
    if (!quiz || !(await canAccessQuiz(quiz, auth.user.id))) {
      return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
    }
    if (quiz.ownerId) {
      // A personal quiz is only visible to its owner, so the class couldn't
      // open it.
      return NextResponse.json(
        { error: 'Хувийн quiz-ийг даалгаварт хавсаргах боломжгүй. Ангийн тэмдэглэлээс quiz үүсгэнэ үү.' },
        { status: 400 },
      );
    }
  }

  // The attachment is also optional — only validate/store one if a file was
  // actually provided (an empty file input still shows up as a File with
  // size 0 in some browsers, so check that too before treating it as "no
  // file").
  const file = formData.get('file');
  let materialId: string | null = null;
  if (file instanceof File && file.size > 0) {
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
    const material = await insertMaterial({
      classId,
      uploadedBy: auth.user.id,
      file,
    });
    materialId = material.id;
  }

  const [row] = await db
    .insert(assignments)
    .values({
      classId,
      quizId,
      materialId,
      title,
      description,
      dueAt,
    })
    .returning();

  await notifyUsers(await classStudentIds(classId), {
    title: `Шинэ даалгавар: ${title}`,
    body: `${klass.name} ангид${dueAt ? ' — хугацаа: ' + formatDue(dueAt) : ''}`,
    href: `/classroom?classId=${classId}`,
  });

  return NextResponse.json(toAssignment(row), { status: 201 });
}
