import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { assignments, classMembers, notifications, submissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { archivedGuard, getClassMembership } from '@/lib/access';
import { formatDue } from '@/lib/dueDate';
import { todayUb } from '@/lib/points/rules';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ assignmentId: string }> };

/** Admin: nudges every member who hasn't handed the assignment in yet. At
 * most once a day per member — pressing it again the same day sends
 * nothing new. Returns how many were reminded and how many are missing. */
export async function POST(request: Request, { params }: Params) {
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
  const { klass, isTeacher } = await getClassMembership(assignment.classId, auth.user.id);
  if (!klass) {
    return NextResponse.json({ error: 'Даалгавар олдсонгүй.' }, { status: 404 });
  }
  if (!isTeacher) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийн админ сануулга илгээх боломжтой.' },
      { status: 403 },
    );
  }
  const archived = archivedGuard(klass);
  if (archived) return archived;

  const missing = await db
    .select({ id: classMembers.studentId })
    .from(classMembers)
    .where(
      and(
        eq(classMembers.classId, assignment.classId),
        sql`not exists (
          select 1 from ${submissions}
          where ${submissions.assignmentId} = ${assignmentId}
            and ${submissions.studentId} = ${classMembers.studentId}
        )`,
      ),
    );
  if (missing.length === 0) return NextResponse.json({ reminded: 0, missing: 0 });

  const created = await db
    .insert(notifications)
    .values(
      missing.map(({ id }) => ({
        userId: id,
        title: `⏰ "${assignment.title}" даалгавраа илгээгээрэй`,
        body: `${klass.name}${assignment.dueAt ? ` — хугацаа: ${formatDue(assignment.dueAt)}` : ''}`,
        href: `/classroom?classId=${assignment.classId}&tab=classwork`,
        dedupeKey: `remind:${assignmentId}:${todayUb()}`,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  return NextResponse.json({ reminded: created.length, missing: missing.length });
}
