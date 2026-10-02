import { NextResponse } from 'next/server';
import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { gamePlayers, gameSessions, quizzes } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { canAccessQuiz } from '@/lib/access';
import { answersVisibleTo, quizLockedFor } from '@/lib/quiz/answers';
import { generateUniqueCode } from '@/lib/codes';
import { pgErrorCode, UNIQUE_VIOLATION } from '@/lib/dbErrors';
import { GAME_MAX_AGE_MS } from '@/lib/game';
import { toGameSession } from '@/lib/mappers';

// A group or class quiz has one shared lobby: while one is still open, everyone
// in the group or class who hits "play" lands in it instead of spawning a lobby of their own.

// Creates the DB record for a live game and hands back its join code. This
// only covers the REST surface — actually running a live match (players
// joining, scoring, a leaderboard) would need a stateful realtime server
// (see the comment in src/lib/socket.ts), which this app doesn't have yet.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const quizId = typeof body?.quizId === 'string' ? body.quizId : '';
  if (!quizId) {
    return NextResponse.json({ error: 'Quiz сонгоно уу.' }, { status: 400 });
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

  if (quiz.groupId || quiz.classId) {
    const [open] = await db
      .select()
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.quizId, quizId),
          eq(gameSessions.status, 'lobby'),
          gt(gameSessions.createdAt, new Date(Date.now() - GAME_MAX_AGE_MS)),
        ),
      )
      .orderBy(desc(gameSessions.createdAt))
      .limit(1);
    if (open) {
      if (open.createdBy !== auth.user.id) {
        try {
          await db
            .insert(gamePlayers)
            .values({ gameSessionId: open.id, userId: auth.user.id });
        } catch (err) {
          if (pgErrorCode(err) !== UNIQUE_VIOLATION) throw err;
        }
      }
      return NextResponse.json(toGameSession(open), { status: 200 });
    }
  }

  // A live game shows every answer once revealed, so while an assignment a
  // member can still hand in uses this quiz, only an admin may start one.
  if (
    !(await answersVisibleTo(quiz, auth.user.id)) &&
    (await quizLockedFor(quiz.id, auth.user.id))
  ) {
    return NextResponse.json(
      { error: 'Энэ quiz нээлттэй даалгаварт ашиглагдаж байгаа тул хугацаа дуустал зөвхөн админ тоглоом эхлүүлнэ.' },
      { status: 409 },
    );
  }

  const code = await generateUniqueCode(async (candidate) => {
    const [existing] = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(eq(gameSessions.code, candidate))
      .limit(1);
    return !existing;
  });

  const [row] = await db
    .insert(gameSessions)
    .values({ code, quizId, createdBy: auth.user.id })
    .returning();

  return NextResponse.json(toGameSession(row), { status: 201 });
}
