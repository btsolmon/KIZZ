import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classCoTeachers, classMembers, classes, notifications } from '@/db/schema';

interface NotificationInput {
  title: string;
  body?: string;
  href?: string;
}

/** Best-effort: a failed notification must never fail the action that
 * triggered it, so errors are swallowed. */
export async function notifyUsers(
  userIds: string[],
  input: NotificationInput,
): Promise<void> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return;
  try {
    await getDb()
      .insert(notifications)
      .values(
        unique.map((userId) => ({
          userId,
          title: input.title,
          body: input.body ?? '',
          href: input.href ?? null,
        })),
      );
  } catch (err) {
    console.error('notifyUsers failed', err);
  }
}

export async function classStudentIds(classId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: classMembers.studentId })
    .from(classMembers)
    .where(eq(classMembers.classId, classId));
  return rows.map((r) => r.id);
}

export async function classTeacherIds(classId: string): Promise<string[]> {
  const db = getDb();
  const [[klass], co] = await Promise.all([
    db
      .select({ teacherId: classes.teacherId })
      .from(classes)
      .where(eq(classes.id, classId))
      .limit(1),
    db
      .select({ id: classCoTeachers.teacherId })
      .from(classCoTeachers)
      .where(eq(classCoTeachers.classId, classId)),
  ]);
  return [...(klass ? [klass.teacherId] : []), ...co.map((r) => r.id)];
}
