import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { assignments, classes, submissions } from '@/db/schema';
import { getClassMembership } from '@/lib/access';
import type { Question, Quiz, QuizCheckResult } from '@/lib/types';

// A group's members never receive a quiz's answer key up front: they could
// read it in the browser and hand in a perfect assignment. They answer first
// and the server says what was right (POST /quizzes/:id/check).

/** The quiz without its answer key, for a viewer who may not see it. */
export function withoutAnswers(quiz: Quiz): Quiz {
  return {
    ...quiz,
    questions: quiz.questions.map(({ id, prompt, options }) => ({ id, prompt, options })),
    answersHidden: true,
  };
}

/** Whether `userId` gets the answer key of this quiz with it: the owner of a
 * personal quiz and a group's admins do, the group's members don't. */
export async function answersVisibleTo(
  quiz: { ownerId: string | null; classId: string | null },
  userId: string,
): Promise<boolean> {
  if (quiz.ownerId) return quiz.ownerId === userId;
  if (!quiz.classId) return true; // legacy study group: no admins to hide it from
  const { isTeacher } = await getClassMembership(quiz.classId, userId);
  return isTeacher;
}

/** True while an assignment that `userId` can still hand in uses this quiz.
 * Until then a member doesn't get its correct answers from anywhere — not
 * from practice and not by hosting a live game — only whether their own
 * answers were right. An assignment is closed for them once its deadline
 * has passed and they have submitted (a late first submission is still
 * allowed), or when the group is archived. */
export async function quizLockedFor(quizId: string, userId: string): Promise<boolean> {
  const [open] = await getDb()
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .where(
      and(
        eq(assignments.quizId, quizId),
        isNull(classes.archivedAt),
        sql`not (
          ${assignments.dueAt} is not null and ${assignments.dueAt} <= now()
          and exists (
            select 1 from ${submissions}
            where ${submissions.assignmentId} = ${assignments.id}
              and ${submissions.studentId} = ${userId}
          )
        )`,
      ),
    )
    .limit(1);
  return !!open;
}

/** Checks picked options against the answer key. With `reveal` each result
 * also carries the correct option and its explanation. Unknown question ids
 * are skipped. */
export function checkAnswers(
  questions: Question[],
  picks: { questionId: string; optionIndex: number | null }[],
  reveal: boolean,
): QuizCheckResult[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return picks.flatMap(({ questionId, optionIndex }) => {
    const q = byId.get(questionId);
    if (!q) return [];
    const correct = optionIndex === q.correctIndex;
    return reveal
      ? [{ questionId, correct, correctIndex: q.correctIndex, explanation: q.explanation }]
      : [{ questionId, correct }];
  });
}
