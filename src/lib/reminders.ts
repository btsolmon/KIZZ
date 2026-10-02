import { and, gt, isNull, lte, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { formatDue } from '@/lib/dueDate';
import { assignments, classMembers, classes, notifications, submissions } from '@/db/schema';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** There is no scheduler, so "due soon" reminders are created lazily whenever
 * the user's notifications are fetched: for each assignment they still have
 * to hand in that is due within 24 hours. A dedupe key makes sure each
 * reminder is only created once. Best-effort — never fails the request. */
export async function ensureDueReminders(userId: string): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    const due = await db
      .select({
        id: assignments.id,
        title: assignments.title,
        classId: assignments.classId,
        dueAt: assignments.dueAt,
      })
      .from(assignments)
      .innerJoin(
        classMembers,
        and(eq(classMembers.classId, assignments.classId), eq(classMembers.studentId, userId)),
      )
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .leftJoin(
        submissions,
        and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, userId)),
      )
      .where(
        and(
          gt(assignments.dueAt, now),
          lte(assignments.dueAt, new Date(now.getTime() + WINDOW_MS)),
          isNull(submissions.id),
          // Nothing can be handed in once a group is archived.
          isNull(classes.archivedAt),
        ),
      );
    if (due.length === 0) return;

    await db
      .insert(notifications)
      .values(
        due.map((a) => ({
          userId,
          title: `⏰ "${a.title}" даалгаврын хугацаа удахгүй дуусна`,
          body: `Хугацаа: ${formatDue(a.dueAt!)}`,
          href: `/classroom?classId=${a.classId}&tab=classwork`,
          dedupeKey: `due:${a.id}`,
        })),
      )
      .onConflictDoNothing();
  } catch (err) {
    console.error('ensureDueReminders failed', err);
  }
}
