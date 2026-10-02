import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { quizzes } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { canAccessQuiz } from '@/lib/access';
import { answersVisibleTo, checkAnswers, quizLockedFor } from '@/lib/quiz/answers';
import { MAX_QUESTIONS } from '@/lib/quiz/validate';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ quizId: string }> };

/** Practice for someone who doesn't hold the answer key: checks the picked
 * options and, unless an open assignment still uses the quiz, says which
 * ones were right. Body: `{ answers: [{ questionId, optionIndex }] }`. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { quizId } = await params;
  if (!isUuid(quizId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const [quiz] = await getDb().select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
  if (!quiz || !(await canAccessQuiz(quiz, auth.user.id))) {
    return NextResponse.json({ error: 'Quiz олдсонгүй.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.answers) ? body.answers : [];
  if (raw.length === 0 || raw.length > MAX_QUESTIONS) {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }
  const picks = raw.flatMap((a) => {
    const item = a as { questionId?: unknown; optionIndex?: unknown };
    if (typeof item?.questionId !== 'string') return [];
    const optionIndex = Number.isInteger(item.optionIndex) ? (item.optionIndex as number) : null;
    return [{ questionId: item.questionId, optionIndex }];
  });

  const reveal =
    (await answersVisibleTo(quiz, auth.user.id)) || !(await quizLockedFor(quiz.id, auth.user.id));
  return NextResponse.json({ results: checkAnswers(quiz.questions, picks, reveal) });
}
