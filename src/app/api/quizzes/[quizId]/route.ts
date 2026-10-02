import { NextResponse } from 'next/server';
import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { assignments, gameSessions, quizzes, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { canAccessQuiz, getClassMembership } from '@/lib/access';
import { deleteGamesForQuizzes } from '@/lib/deletion';
import { GAME_MAX_AGE_MS } from '@/lib/game';
import { toQuiz } from '@/lib/mappers';
import { answersVisibleTo, withoutAnswers } from '@/lib/quiz/answers';
import { parseQuestions, parseTitle } from '@/lib/quiz/validate';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ quizId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { quizId } = await params;
  if (!isUuid(quizId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const [quiz] = await getDb()
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);
  if (!quiz || !(await canAccessQuiz(quiz, auth.user.id))) {
    return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
  }

  const visible = await answersVisibleTo(quiz, auth.user.id);
  return NextResponse.json(visible ? toQuiz(quiz) : withoutAnswers(toQuiz(quiz)));
}

/** Personal quizzes: the owner. Class quizzes: a class admin. A quiz that an
 * assignment still uses must be unlinked (assignment deleted) first. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { quizId } = await params;
  if (!isUuid(quizId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const db = getDb();
  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);
  if (!quiz || !(await canAccessQuiz(quiz, auth.user.id))) {
    return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
  }

  if (!(await canManageQuiz(quiz, auth.user.id))) {
    return NextResponse.json(
      { error: 'Зөвхөн quiz-ийн эзэн эсвэл бүлгийн админ устгах боломжтой.' },
      { status: 403 },
    );
  }

  const [used] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.quizId, quizId))
    .limit(1);
  if (used) {
    return NextResponse.json(
      { error: 'Энэ quiz даалгаварт ашиглагдаж байна. Эхлээд даалгаврыг устгана уу.' },
      { status: 409 },
    );
  }

  await db.transaction(async (tx) => {
    await deleteGamesForQuizzes(tx, [quizId]);
    await tx.delete(quizzes).where(eq(quizzes.id, quizId));
  });
  return NextResponse.json({ ok: true });
}

/** Can `userId` manage (edit/delete) this quiz? Personal: the owner. Class
 * quiz: a class admin. */
async function canManageQuiz(
  quiz: { ownerId: string | null; classId: string | null },
  userId: string,
): Promise<boolean> {
  if (quiz.ownerId) return quiz.ownerId === userId;
  if (!quiz.classId) return false;
  const { isTeacher } = await getClassMembership(quiz.classId, userId);
  return isTeacher;
}

/** Edit title and/or questions. Refused while a live game is using the quiz;
 * once members have submitted an assignment built on it, questions can be
 * reworded or re-keyed but not added, removed or reordered (their stored
 * answers are positional). */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { quizId } = await params;
  if (!isUuid(quizId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const db = getDb();
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
  if (!quiz || !(await canAccessQuiz(quiz, auth.user.id))) {
    return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
  }
  if (!(await canManageQuiz(quiz, auth.user.id))) {
    return NextResponse.json(
      { error: 'Зөвхөн quiz-ийн эзэн эсвэл бүлгийн админ засах боломжтой.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  const patch: Partial<typeof quizzes.$inferInsert> = {};
  if ('isPublic' in body) {
    // Only a personal quiz can be shared; a group's quizzes stay in the group.
    if (typeof body.isPublic !== 'boolean' || !quiz.ownerId) {
      return NextResponse.json(
        { error: 'Зөвхөн хувийн quiz-ийг нийтийн санд нийтэлж болно.' },
        { status: 400 },
      );
    }
    patch.isPublic = body.isPublic;
    patch.publishedAt = body.isPublic ? (quiz.publishedAt ?? new Date()) : null;
  }
  if ('title' in body) {
    const title = parseTitle(body.title);
    if (!title) {
      return NextResponse.json({ error: 'Гарчгаа зөв оруулна уу.' }, { status: 400 });
    }
    patch.title = title;
  }
  if ('questions' in body) {
    const questions = parseQuestions(body.questions);
    if (typeof questions === 'string') {
      return NextResponse.json({ error: questions }, { status: 400 });
    }

    const [live] = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.quizId, quizId),
          ne(gameSessions.status, 'finished'),
          // A game nobody closed (browser killed) expires, see GAME_MAX_AGE_MS.
          gt(gameSessions.createdAt, new Date(Date.now() - GAME_MAX_AGE_MS)),
        ),
      )
      .limit(1);
    if (live) {
      return NextResponse.json(
        { error: 'Энэ quiz-ээр тоглоом явагдаж байна. Тоглоом дууссаны дараа засна уу.' },
        { status: 409 },
      );
    }

    const before = quiz.questions.map((q) => q.id);
    const sameStructure =
      before.length === questions.length && before.every((id, i) => id === questions[i].id);
    if (!sameStructure) {
      const used = await db
        .select({ id: assignments.id })
        .from(assignments)
        .where(eq(assignments.quizId, quizId));
      if (used.length > 0) {
        const [submitted] = await db
          .select({ id: submissions.id })
          .from(submissions)
          .where(inArray(submissions.assignmentId, used.map((a) => a.id)))
          .limit(1);
        if (submitted) {
          return NextResponse.json(
            { error: 'Илгээлттэй даалгаварт ашигласан quiz-д асуулт нэмэх, устгах, дарааллыг солих боломжгүй. Асуултын текст, зөв хариултыг л засна уу.' },
            { status: 409 },
          );
        }
      }
    }
    patch.questions = questions;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Юу ч өөрчлөгдсөнгүй.' }, { status: 400 });
  }

  const [row] = await db.update(quizzes).set(patch).where(eq(quizzes.id, quizId)).returning();
  return NextResponse.json(toQuiz(row));
}
