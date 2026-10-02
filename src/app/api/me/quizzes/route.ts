import { NextResponse } from 'next/server';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  classCoTeachers,
  classMembers,
  classes,
  quizzes,
} from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { toQuiz } from '@/lib/mappers';
import { withoutAnswers } from '@/lib/quiz/answers';

/** Every quiz the caller can use: their personal quizzes plus those of any
 * class they own, co-teach, or belong to. Quizzes of a class they only
 * belong to come without the answer key. */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const db = getDb();
  const userId = auth.user.id;

  const [owned, coTaught, joined] = await Promise.all([
    db.select({ id: classes.id }).from(classes).where(eq(classes.teacherId, userId)),
    db
      .select({ id: classCoTeachers.classId })
      .from(classCoTeachers)
      .where(eq(classCoTeachers.teacherId, userId)),
    db
      .select({ id: classMembers.classId })
      .from(classMembers)
      .where(eq(classMembers.studentId, userId)),
  ]);
  const classIds = [...owned, ...coTaught, ...joined].map((r) => r.id);
  const adminOf = new Set([...owned, ...coTaught].map((r) => r.id));

  const rows = await db
    .select()
    .from(quizzes)
    .where(
      classIds.length > 0
        ? or(eq(quizzes.ownerId, userId), inArray(quizzes.classId, classIds))
        : eq(quizzes.ownerId, userId),
    )
    .orderBy(desc(quizzes.createdAt));

  return NextResponse.json(
    rows.map((row) =>
      row.classId && !adminOf.has(row.classId) ? withoutAnswers(toQuiz(row)) : toQuiz(row),
    ),
  );
}
