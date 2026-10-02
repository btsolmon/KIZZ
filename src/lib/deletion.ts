import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  assignments,
  classCoTeachers,
  classMaterials,
  classMembers,
  classPostComments,
  classPosts,
  classes,
  dailyStreaks,
  gameAnswers,
  gamePlayers,
  gameResults,
  gameSessions,
  noteAttachments,
  notes,
  pointTransactions,
  quizzes,
  submissions,
  userInventory,
  users,
} from '@/db/schema';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Removes live-game history (answers, players, results, sessions) for the
 * given quizzes — a game can't outlive the quiz it was played from. */
export async function deleteGamesForQuizzes(tx: Tx, quizIds: string[]) {
  if (quizIds.length === 0) return;
  const sessions = await tx
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(inArray(gameSessions.quizId, quizIds));
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return;
  await tx.delete(gameAnswers).where(inArray(gameAnswers.gameSessionId, sessionIds));
  await tx.delete(gameResults).where(inArray(gameResults.gameSessionId, sessionIds));
  await tx.delete(gamePlayers).where(inArray(gamePlayers.gameSessionId, sessionIds));
  await tx.delete(gameSessions).where(inArray(gameSessions.id, sessionIds));
}

/** Deletes the submissions matching `where` along with the files members
 * attached to them (those are private to the submission, never shared). */
async function deleteSubmissions(tx: Tx, where: SQL) {
  const files = await tx
    .select({ materialId: submissions.materialId })
    .from(submissions)
    .where(and(where, isNotNull(submissions.materialId)));
  await tx.delete(submissions).where(where);
  const ids = files.map((f) => f.materialId!);
  if (ids.length > 0) {
    await tx.delete(classMaterials).where(inArray(classMaterials.id, ids));
  }
}

export async function deleteAssignmentCascade(assignmentId: string) {
  await getDb().transaction(async (tx) => {
    await deleteSubmissions(tx, eq(submissions.assignmentId, assignmentId));
    await tx.delete(assignments).where(eq(assignments.id, assignmentId));
  });
}

/** Deletes a whole class with everything inside it. */
export async function deleteClassCascade(classId: string) {
  await getDb().transaction(async (tx) => {
    const classAssignments = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.classId, classId));
    const assignmentIds = classAssignments.map((a) => a.id);
    if (assignmentIds.length > 0) {
      await tx.delete(submissions).where(inArray(submissions.assignmentId, assignmentIds));
      await tx.delete(assignments).where(inArray(assignments.id, assignmentIds));
    }

    const classQuizzes = await tx
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(eq(quizzes.classId, classId));
    const quizIds = classQuizzes.map((q) => q.id);
    await deleteGamesForQuizzes(tx, quizIds);
    if (quizIds.length > 0) {
      await tx.delete(quizzes).where(inArray(quizzes.id, quizIds));
    }

    // Note attachments cascade with their notes.
    await tx.delete(classPosts).where(eq(classPosts.classId, classId)); // comments cascade
    await tx.delete(notes).where(eq(notes.classId, classId));
    await tx.delete(classMaterials).where(eq(classMaterials.classId, classId));
    await tx.delete(classMembers).where(eq(classMembers.classId, classId));
    await tx.delete(classCoTeachers).where(eq(classCoTeachers.classId, classId));
    await tx.delete(classes).where(eq(classes.id, classId));
  });
}

export async function removeClassMember(classId: string, userId: string) {
  const db = getDb();
  await db
    .delete(classMembers)
    .where(and(eq(classMembers.classId, classId), eq(classMembers.studentId, userId)));
  await db
    .delete(classCoTeachers)
    .where(and(eq(classCoTeachers.classId, classId), eq(classCoTeachers.teacherId, userId)));
}

/** Permanently deletes an account and everything it owns. Content it
 * contributed to other people's groups (shared notes, files) stays, handed
 * over to that group's owner. */
export async function deleteUserCascade(userId: string) {
  const db = getDb();
  const owned = await db
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.teacherId, userId));
  for (const c of owned) await deleteClassCascade(c.id);

  await db.transaction(async (tx) => {
    // Live games: hosted by the user, or joined by the user.
    const hosted = await tx
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(eq(gameSessions.createdBy, userId));
    const hostedIds = hosted.map((g) => g.id);
    const myPlayers = await tx
      .select({ id: gamePlayers.id })
      .from(gamePlayers)
      .where(eq(gamePlayers.userId, userId));
    const myPlayerIds = myPlayers.map((p) => p.id);
    if (myPlayerIds.length > 0) {
      await tx.delete(gameAnswers).where(inArray(gameAnswers.playerId, myPlayerIds));
    }
    if (hostedIds.length > 0) {
      await tx.delete(gameAnswers).where(inArray(gameAnswers.gameSessionId, hostedIds));
      await tx.delete(gameResults).where(inArray(gameResults.gameSessionId, hostedIds));
      await tx.delete(gamePlayers).where(inArray(gamePlayers.gameSessionId, hostedIds));
      await tx.delete(gameSessions).where(inArray(gameSessions.id, hostedIds));
    }
    await tx.delete(gameResults).where(eq(gameResults.userId, userId));
    await tx.delete(gamePlayers).where(eq(gamePlayers.userId, userId));

    // Personal quizzes and notes.
    const myQuizzes = await tx
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(eq(quizzes.ownerId, userId));
    const myQuizIds = myQuizzes.map((q) => q.id);
    await deleteGamesForQuizzes(tx, myQuizIds);
    if (myQuizIds.length > 0) {
      await tx.delete(quizzes).where(inArray(quizzes.id, myQuizIds));
    }
    await tx.delete(notes).where(eq(notes.ownerId, userId));

    // Contributions inside other people's groups.
    await tx.delete(noteAttachments).where(eq(noteAttachments.uploadedBy, userId));
    await tx.execute(sql`update class_materials set uploaded_by = c.teacher_id
      from classes c where class_materials.class_id = c.id and class_materials.uploaded_by = ${userId}`);
    await tx.execute(sql`update notes set updated_by = c.teacher_id
      from classes c where notes.class_id = c.id and notes.updated_by = ${userId}`);

    // Comments are removed; announcements written in other people's groups
    // are handed to that group's owner.
    await tx.delete(classPostComments).where(eq(classPostComments.authorId, userId));
    await tx.execute(sql`update class_posts set author_id = c.teacher_id
      from classes c where class_posts.class_id = c.id and class_posts.author_id = ${userId}`);
    await deleteSubmissions(tx, eq(submissions.studentId, userId));
    await tx.delete(classMembers).where(eq(classMembers.studentId, userId));
    await tx.delete(classCoTeachers).where(eq(classCoTeachers.teacherId, userId));
    await tx.delete(pointTransactions).where(eq(pointTransactions.userId, userId));
    await tx.delete(userInventory).where(eq(userInventory.userId, userId));
    await tx.delete(dailyStreaks).where(eq(dailyStreaks.userId, userId));
    // Notifications cascade with the user.
    await tx.delete(users).where(eq(users.id, userId));
  });
}
