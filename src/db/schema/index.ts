import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Question } from '@/lib/types';
import type { AvatarOptions } from '@/lib/avatar';

// --- Auth -------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['teacher', 'student'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Cached running total — always kept in sync with point_transactions inside
  // the same DB transaction (see lib/points/ledger.ts). Avoids a SUM() over
  // the whole ledger on every balance check / purchase.
  pointsBalance: integer('points_balance').notNull().default(0),
  // Lifetime total — unlike pointsBalance (spendable "coins"), xp never goes
  // down on a purchase. Level is derived from this, not stored separately.
  xp: integer('xp').notNull().default(0),
  // null until the user customizes their avatar — the UI falls back to a
  // deterministic per-account look (see lib/avatar.ts) in that case. Stored
  // server-side (not localStorage) so it follows the account across devices.
  avatarOptions: jsonb('avatar_options').$type<AvatarOptions | null>(),
  // A shop avatar the user bought and is currently wearing. When set it wins
  // over avatarOptions everywhere; null means "use my customized avatar".
  equippedItemId: uuid('equipped_item_id').references(
    (): AnyPgColumn => shopItems.id,
  ),
  // Whether the user appears on the global XP leaderboard.
  showOnLeaderboard: boolean('show_on_leaderboard').notNull().default(true),
});

export type UserRow = typeof users.$inferSelect;

// --- Study groups -----------------------------------------------------

export const groups = pgTable('groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GroupRow = typeof groups.$inferSelect;

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

// --- Notes --------------------------------------------------------------

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // A note belongs to exactly one of a study group or a class — groupId is
    // the older join-by-code "study group" concept (no page creates these any
    // more); classId is a classroom's shared note, scoped to that class's
    // teacher + enrolled students. Both nullable so either path works.
    groupId: uuid('group_id').references(() => groups.id),
    classId: uuid('class_id').references(() => classes.id),
    // Set for a personal note (no group/class) — only its owner can see it.
    ownerId: uuid('owner_id').references(() => users.id),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index('notes_class_id_idx').on(table.classId),
    index('notes_owner_id_idx').on(table.ownerId),
  ],
);

export type NoteRow = typeof notes.$inferSelect;

// Files attached to a note (PDF/images). Same storage approach as
// classMaterials: base64 in Postgres, capped per file in the upload route.
export const noteAttachments = pgTable(
  'note_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: text('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('note_attachments_note_id_idx').on(table.noteId)],
);

export type NoteAttachmentRow = typeof noteAttachments.$inferSelect;

// --- Notifications --------------------------------------------------------

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    // App-relative link the notification opens, e.g. /classroom?classId=...
    href: text('href'),
    readAt: timestamp('read_at', { withTimezone: true }),
    // Generated reminders (see dedupeKey) are hidden with this instead of being
    // deleted, so they are not created again on the next fetch.
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    // Set for generated reminders so the same one is only ever created once
    // per user (e.g. `due:<assignmentId>`); null for ordinary notifications.
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('notifications_user_dedupe_idx').on(table.userId, table.dedupeKey)],
);

export type NotificationRow = typeof notifications.$inferSelect;

// --- Quizzes --------------------------------------------------------------

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Mirrors notes.groupId/classId above — a quiz inherits whichever the
    // source note had.
    groupId: uuid('group_id').references(() => groups.id),
    classId: uuid('class_id').references(() => classes.id),
    // Set for a quiz made from a personal note.
    ownerId: uuid('owner_id').references(() => users.id),
    // Null once the source note is deleted — the quiz outlives it.
    sourceNoteId: uuid('source_note_id').references(() => notes.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    questions: jsonb('questions').notNull().$type<Question[]>(),
    generatedBy: text('generated_by', { enum: ['ai', 'rule-based'] }).notNull(),
    // Public library: a personal quiz its owner has shared with everyone.
    isPublic: boolean('is_public').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // How many people copied it into their own quizzes.
    copyCount: integer('copy_count').notNull().default(0),
    // The public quiz this one was copied from (null if the original is gone).
    copiedFromId: uuid('copied_from_id').references(
      (): AnyPgColumn => quizzes.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('quizzes_class_id_idx').on(table.classId),
    index('quizzes_owner_id_idx').on(table.ownerId),
  ],
);

export type QuizRow = typeof quizzes.$inferSelect;

// --- Live games -----------------------------------------------------------
// Polling-based live play (no WebSocket/pub-sub service is configured
// anywhere in this repo, and standing one up means a new external service
// and secrets only the app owner can provision — see the plan notes for
// this feature). Clients poll GET /games/:id/state; the DB row here is the
// single source of truth for lobby -> active -> finished progression.

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['lobby', 'active', 'finished'] })
      .notNull()
      .default('lobby'),
    currentQuestionIndex: integer('current_question_index').notNull().default(0),
    questionStartedAt: timestamp('question_started_at', { withTimezone: true }),
    // Whether the current question's correct answer + tallies are visible yet.
    // Reset to false every time the host advances to a new question.
    revealed: boolean('revealed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('game_sessions_quiz_id_idx').on(table.quizId)],
);

export type GameSessionRow = typeof gameSessions.$inferSelect;

export const gamePlayers = pgTable(
  'game_players',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gameSessionId: uuid('game_session_id')
      .notNull()
      .references(() => gameSessions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    score: integer('score').notNull().default(0),
    streak: integer('streak').notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.gameSessionId, table.userId)],
);

export type GamePlayerRow = typeof gamePlayers.$inferSelect;

export const gameAnswers = pgTable(
  'game_answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gameSessionId: uuid('game_session_id')
      .notNull()
      .references(() => gameSessions.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => gamePlayers.id),
    questionIndex: integer('question_index').notNull(),
    optionIndex: integer('option_index').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    answeredAt: timestamp('answered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.playerId, table.questionIndex),
    // Polled on every live-game state request.
    index('game_answers_session_question_idx').on(table.gameSessionId, table.questionIndex),
  ],
);

export type GameAnswerRow = typeof gameAnswers.$inferSelect;

// --- Classroom ------------------------------------------------------------

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id),
    // One of CLASS_COLORS' keys (src/lib/classColor.ts) — kept as a plain
    // string here rather than a DB enum so the palette can grow without a
    // migration; the frontend falls back to the default swatch for anything
    // it doesn't recognize.
    color: text('color').notNull().default('blue'),
    // Optional descriptive metadata, all editable after creation — mirrors
    // Free-text blurb shown on the group's overview (what it's for, when it
    // meets, ...). Replaced the old section/level/subject/room fields.
    description: text('description'),

    // Null = active. Archiving hides a class from the default class list and
    // blocks new assignments/submissions/materials, without deleting it.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('classes_teacher_id_idx').on(table.teacherId)],
);

export type ClassRow = typeof classes.$inferSelect;

// Files a teacher shares with the whole class ("materials"). Stored as
// base64 in Postgres rather than an object-storage service — there's no
// storage service configured anywhere in this repo, and this works with the
// database that's already set up. Capped at 3MB per file in the upload
// route to stay well under typical serverless request-size limits.
export const classMaterials = pgTable(
  'class_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: text('data').notNull(),
    // A member's own work attached to a submission. Never listed with the
    // group's materials, and only its uploader and the admins can download it.
    isSubmission: boolean('is_submission').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('class_materials_class_id_idx').on(table.classId)],
);

export type ClassMaterialRow = typeof classMaterials.$inferSelect;

export const classMembers = pgTable(
  'class_members',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.classId, table.studentId] }),
    index('class_members_student_id_idx').on(table.studentId),
  ],
);

// A teacher who joined another teacher's class by code — a full co-teacher,
// same permissions as the class's original (primary) teacher everywhere
// `getClassMembership` gates on `isTeacher`, except deleting the class or
// removing the primary teacher isn't exposed to anyone in this app anyway.
export const classCoTeachers = pgTable(
  'class_co_teachers',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.classId, table.teacherId] }),
    index('class_co_teachers_teacher_id_idx').on(table.teacherId),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    // Optional now: an assignment with no quiz is a plain instructional item
    // (title + optional attachment) a student marks done, with no auto score.
    quizId: uuid('quiz_id').references(() => quizzes.id),
    // Optional file attached at creation time (reuses class_materials rather
    // than duplicating file storage).
    materialId: uuid('material_id').references(() => classMaterials.id),
    title: text('title').notNull(),
    // Instructions shown to members when they open the assignment.
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assignments_class_id_idx').on(table.classId),
    index('assignments_quiz_id_idx').on(table.quizId),
  ],
);

export type AssignmentRow = typeof assignments.$inferSelect;

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    answers: jsonb('answers').notNull().$type<(number | null)[]>(),
    // Null means "turned in, not graded" — the case for a quiz-less
    // assignment until the teacher enters a grade manually.
    score: integer('score'),
    // A student's own attached work, optional either way (quiz or not).
    materialId: uuid('material_id').references(() => classMaterials.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.assignmentId, table.studentId)],
);

export type SubmissionRow = typeof submissions.$inferSelect;

// --- Points ledger -----------------------------------------------------------

export const pointTransactionType = [
  'quiz_placement',
  'daily_streak',
  'shop_purchase',
  'admin_adjustment',
  'assignment_completed',
  'first_note',
  'first_quiz',
] as const;

export type PointTransactionType = (typeof pointTransactionType)[number];

export const pointTransactions = pgTable(
  'point_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // Positive for earned points, negative for spent points — the ledger is
    // the source of truth; users.pointsBalance is a derived cache of SUM(amount).
    amount: integer('amount').notNull(),
    // XP granted by this transaction. Independent of coins: spending coins
    // grants none, and some events (first note, ...) grant XP but no coins.
    xp: integer('xp').notNull().default(0),
    type: text('type', { enum: pointTransactionType }).notNull(),
    // Free-form pointer to the thing that caused this transaction: a game
    // session id for placements, a shop item id for purchases, etc.
    referenceId: text('reference_id'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('point_transactions_user_created_idx').on(table.userId, table.createdAt)],
);

export type PointTransactionRow = typeof pointTransactions.$inferSelect;

// --- Daily login streak -------------------------------------------------------

export const dailyStreaks = pgTable('daily_streaks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  // Stored as a plain date (no time/timezone) — streak logic compares whole
  // calendar days in UTC, see lib/points/streak.ts.
  lastClaimedDate: text('last_claimed_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DailyStreakRow = typeof dailyStreaks.$inferSelect;

// Singleton config row (id is always 1) so the reward curve is tunable
// without a code change: points for day N of a streak = min(basePoints +
// (N - 1) * incrementPoints, maxPoints).
export const streakConfig = pgTable('streak_config', {
  id: integer('id').primaryKey().default(1),
  basePoints: integer('base_points').notNull().default(10),
  incrementPoints: integer('increment_points').notNull().default(10),
  maxPoints: integer('max_points'),
});

export type StreakConfigRow = typeof streakConfig.$inferSelect;

// --- Quiz / tournament placement rewards --------------------------------------

// rank 0 is reserved as the fallback ("participation") reward for any
// placement that isn't explicitly configured.
export const placementRewards = pgTable('placement_rewards', {
  rank: integer('rank').primaryKey(),
  points: integer('points').notNull(),
});

export type PlacementRewardRow = typeof placementRewards.$inferSelect;

export const gameResults = pgTable(
  'game_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gameSessionId: text('game_session_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    rank: integer('rank').notNull(),
    score: integer('score').notNull(),
    awardedPoints: integer('awarded_points').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('game_results_session_id_idx').on(table.gameSessionId)],
);

export type GameResultRow = typeof gameResults.$inferSelect;

// --- Avatar store --------------------------------------------------------------

// Every shop item is a whole ready-made avatar look, not a trait swap —
// `value` is the full, ready-to-render DiceBear image URL (any DiceBear
// style, e.g. "thumbs", "adventurer"). See src/db/seed.ts for how to add more.
export const shopItemCategory = ['avatarPreset'] as const;

export const shopItems = pgTable(
  'shop_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category', { enum: shopItemCategory }).notNull(),
    value: text('value').notNull(),
    price: integer('price').notNull(),
    // Player level needed before this can be bought (1 = always available).
    minLevel: integer('min_level').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.category, table.value)],
);

export type ShopItemRow = typeof shopItems.$inferSelect;

export const userInventory = pgTable(
  'user_inventory',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    shopItemId: uuid('shop_item_id')
      .notNull()
      .references(() => shopItems.id),
    purchasedAt: timestamp('purchased_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.shopItemId] })],
);

export type UserInventoryRow = typeof userInventory.$inferSelect;

// --- Group announcements --------------------------------------------------
// Admins post announcements to a group; members comment on them.

export const classPosts = pgTable(
  'class_posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    // A file attached to the post (from the group's materials); optional.
    materialId: uuid('material_id').references(() => classMaterials.id),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Feed order: pinned first, then newest.
    index('class_posts_feed_idx').on(table.classId, table.pinned, table.createdAt),
  ],
);

export type ClassPostRow = typeof classPosts.$inferSelect;

export const classPostComments = pgTable(
  'class_post_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => classPosts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('class_post_comments_post_id_idx').on(table.postId)],
);

export type ClassPostCommentRow = typeof classPostComments.$inferSelect;

// --- Badges ---------------------------------------------------------------
// Which badges (defined in lib/badges.ts) each user has earned.

export const userBadges = pgTable(
  'user_badges',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeKey: text('badge_key').notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.badgeKey] })],
);
