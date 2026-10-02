import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  classCoTeachers,
  classes,
  classMembers,
  groupMembers,
  type ClassRow,
} from '@/db/schema';

export async function isGroupMember(
  groupId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    )
    .limit(1);
  return !!row;
}

/** Ready-to-return 409 when `klass` is archived (no new assignments,
 * submissions, files or announcements), otherwise null. */
export function archivedGuard(klass: Pick<ClassRow, 'archivedAt'>): NextResponse | null {
  if (!klass.archivedAt) return null;
  return NextResponse.json(
    { error: 'Энэ бүлэг архивлагдсан тул шинээр нэмэх боломжгүй.' },
    { status: 409 },
  );
}

export interface ClassMembership {
  klass: ClassRow | null;
  isTeacher: boolean;
  isMember: boolean;
}

/** Loads a class and resolves whether `userId` may see it — as the primary
 * teacher, as a co-teacher who joined by code (full teacher permissions
 * everywhere this gates on `isTeacher`), or as a student who joined by
 * code. One round trip: nearly every group request starts here. */
export async function getClassMembership(
  classId: string,
  userId: string,
): Promise<ClassMembership> {
  const [row] = await getDb()
    .select({
      klass: classes,
      isCoTeacher: sql<boolean>`exists (
        select 1 from ${classCoTeachers}
        where ${classCoTeachers.classId} = ${classes.id} and ${classCoTeachers.teacherId} = ${userId}
      )`,
      isStudent: sql<boolean>`exists (
        select 1 from ${classMembers}
        where ${classMembers.classId} = ${classes.id} and ${classMembers.studentId} = ${userId}
      )`,
    })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);

  if (!row) return { klass: null, isTeacher: false, isMember: false };
  const isTeacher = row.klass.teacherId === userId || row.isCoTeacher;
  return { klass: row.klass, isTeacher, isMember: isTeacher || row.isStudent };
}

/** A note or quiz is personal (owned by one user), or belongs to a study
 * group or a class — this checks whichever applies. None set is denied. */
async function canAccessGroupOrClassScoped(
  row: {
    groupId: string | null;
    classId: string | null;
    ownerId: string | null;
  },
  userId: string,
): Promise<boolean> {
  if (row.ownerId) return row.ownerId === userId;
  if (row.classId) {
    const { isMember } = await getClassMembership(row.classId, userId);
    return isMember;
  }
  if (row.groupId) {
    return isGroupMember(row.groupId, userId);
  }
  return false;
}

export const canAccessNote = canAccessGroupOrClassScoped;
export const canAccessQuiz = canAccessGroupOrClassScoped;
