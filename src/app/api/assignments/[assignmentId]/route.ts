import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { assignments, quizzes, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { getClassMembership } from '@/lib/access';
import { deleteAssignmentCascade } from '@/lib/deletion';
import { formatDue, parseDueInput } from '@/lib/dueDate';
import { classStudentIds, notifyUsers } from '@/lib/notifications';
import { toAssignment, toQuiz, toSubmission } from '@/lib/mappers';
import { quizLockedFor, withoutAnswers } from '@/lib/quiz/answers';
import type { AssignmentDetail } from '@/lib/types';
import { optionalText } from '@/lib/text';
import { isUuid } from '@/lib/uuid';

const MAX_DESCRIPTION = 2000;

type Params = { params: Promise<{ assignmentId: string }> };

export async function GET(request: Request, { params }: Params) {
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

  let quiz = null;
  if (assignment.quizId) {
    [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, assignment.quizId))
      .limit(1);
    if (!quiz) {
      return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
    }
  }

  let mySubmission: AssignmentDetail['mySubmission'] = null;
  if (!isTeacher) {
    const [row] = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.assignmentId, assignmentId),
          eq(submissions.studentId, auth.user.id),
        ),
      )
      .limit(1);
    if (row) mySubmission = toSubmission(row, auth.user.name);
  }

  // A member sees how each of their answers did, but the answer key only
  // once nothing can be handed in with it any more.
  let myCorrect: AssignmentDetail['myCorrect'] = null;
  let quizView = quiz ? toQuiz(quiz) : null;
  if (quiz && quizView && !isTeacher) {
    const answers = mySubmission?.answers;
    if (answers) myCorrect = quiz.questions.map((q, i) => answers[i] === q.correctIndex);
    if (await quizLockedFor(quiz.id, auth.user.id)) quizView = withoutAnswers(quizView);
  }

  const detail: AssignmentDetail = {
    ...toAssignment(assignment),
    quiz: quizView,
    mySubmission,
    myCorrect,
  };
  return NextResponse.json(detail);
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { assignmentId } = await params;
  if (!isUuid(assignmentId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const [assignment] = await getDb()
    .select({ id: assignments.id, classId: assignments.classId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    return NextResponse.json(
      { error: 'Даалгавар олдсонгүй.' },
      { status: 404 },
    );
  }

  const { isTeacher } = await getClassMembership(
    assignment.classId,
    auth.user.id,
  );
  if (!isTeacher) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийн админ даалгавар устгах боломжтой.' },
      { status: 403 },
    );
  }

  await deleteAssignmentCascade(assignmentId);
  return NextResponse.json({ ok: true });
}

/** Admin: rename an assignment, change its instructions or move its due
 * date. Members are told when the deadline changes. */
export async function PATCH(request: Request, { params }: Params) {
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
    return NextResponse.json({ error: 'Даалгавар олдсонгүй.' }, { status: 404 });
  }
  const { isTeacher } = await getClassMembership(assignment.classId, auth.user.id);
  if (!isTeacher) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийн админ даалгавар засах боломжтой.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  const patch: Partial<typeof assignments.$inferInsert> = {};
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) {
      return NextResponse.json({ error: 'Даалгаврын нэрийг зөв оруулна уу.' }, { status: 400 });
    }
    patch.title = title;
  }
  if ('description' in body) {
    const description = optionalText(body.description);
    if (description && description.length > MAX_DESCRIPTION) {
      return NextResponse.json(
        { error: `Заавар ${MAX_DESCRIPTION} тэмдэгтээс ихгүй байх ёстой.` },
        { status: 400 },
      );
    }
    patch.description = description;
  }
  let dueChanged = false;
  if ('dueAt' in body) {
    const dueAt = parseDueInput(body.dueAt);
    if (dueAt === undefined) {
      return NextResponse.json({ error: 'Хугацаа буруу байна.' }, { status: 400 });
    }
    patch.dueAt = dueAt;
    dueChanged = (dueAt?.getTime() ?? null) !== (assignment.dueAt?.getTime() ?? null);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Юу ч өөрчлөгдсөнгүй.' }, { status: 400 });
  }

  const [row] = await db
    .update(assignments)
    .set(patch)
    .where(eq(assignments.id, assignmentId))
    .returning();

  if (dueChanged) {
    await notifyUsers(await classStudentIds(assignment.classId), {
      title: `"${row.title}" даалгаврын хугацаа өөрчлөгдлөө`,
      body: row.dueAt
        ? `Шинэ хугацаа: ${formatDue(row.dueAt)}`
        : 'Хугацаа хасагдлаа',
      href: `/classroom?classId=${assignment.classId}&tab=classwork`,
    });
  }
  return NextResponse.json(toAssignment(row));
}
