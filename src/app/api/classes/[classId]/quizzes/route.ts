import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { quizzes } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { getClassMembership } from '@/lib/access';
import { toQuiz } from '@/lib/mappers';
import { withoutAnswers } from '@/lib/quiz/answers';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ classId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass, isMember, isTeacher } = await getClassMembership(classId, auth.user.id);
  if (!klass || !isMember) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }

  const rows = await getDb()
    .select()
    .from(quizzes)
    .where(eq(quizzes.classId, classId))
    .orderBy(desc(quizzes.createdAt));

  // Only admins get the answer key; members practice against the server.
  return NextResponse.json(
    rows.map((row) => (isTeacher ? toQuiz(row) : withoutAnswers(toQuiz(row)))),
  );
}
