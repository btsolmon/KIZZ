import type { AvatarOptions } from './avatar';

export type Role = 'teacher' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  avatarOptions: AvatarOptions | null;
  /** Bought shop avatar currently worn (wins over avatarOptions). */
  equippedItemId: string | null;
  /** Appears on the global XP leaderboard. */
  showOnLeaderboard: boolean;
}

export interface Group {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export interface Note {
  id: string;
  groupId: string | null;
  classId: string | null;
  title: string;
  content: string;
  updatedAt: string;
  updatedBy: string;
  /** Resolved display name for updatedBy — populated by class-note routes,
   * which already have the class roster on hand. */
  updatedByName?: string;
  /** Only on the response that created the note: XP granted for it. */
  reward?: { xp: number };
}

export interface Question {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

/** A question as the API sends it. A group's members don't get the answer
 * (`correctIndex`, `explanation`) until they may see it — see
 * `Quiz.answersHidden`. */
export type QuizQuestion = Omit<Question, 'correctIndex'> & { correctIndex?: number };

/** One answer checked by the server (practice on a quiz whose answers are
 * hidden). `correctIndex`/`explanation` are left out while an assignment
 * the viewer can still hand in uses the quiz. */
export interface QuizCheckResult {
  questionId: string;
  correct: boolean;
  correctIndex?: number;
  explanation?: string;
}

export interface Quiz {
  id: string;
  groupId: string | null;
  classId: string | null;
  sourceNoteId: string | null;
  /** Set for a personal quiz (only its owner sees it). */
  ownerId: string | null;
  /** Shared in the public library. */
  isPublic: boolean;
  copyCount: number;
  title: string;
  questions: QuizQuestion[];
  /** The answers were left out for this viewer, so practice is checked on
   * the server (POST /quizzes/:id/check). */
  answersHidden?: boolean;
  generatedBy: 'ai' | 'rule-based';
  createdAt: string;
  /** Only on the response that created the quiz: XP granted for it. */
  reward?: { xp: number };
}

export interface GameSession {
  id: string;
  code: string;
}

export type GameStatus = 'lobby' | 'active' | 'finished';

export interface GameQuestionView {
  prompt: string;
  options: string[];
  /** Only present once the host has revealed the current question. */
  correctIndex?: number;
  /** Live per-option answer counts — only present once revealed. */
  tally?: number[];
}

export interface GameState {
  id: string;
  code: string;
  status: GameStatus;
  isHost: boolean;
  /** Who started the game (the host may also be one of the players). */
  hostUserId: string;
  /** The caller has joined as a player. */
  isPlayer: boolean;
  currentQuestionIndex: number;
  totalQuestions: number;
  questionStartedAt: string | null;
  /** Server clock (ISO) when this snapshot was built — lets clients correct for clock skew. */
  serverNow: string;
  revealed: boolean;
  question: GameQuestionView | null;
  /** The caller's own chosen option for the current question, if any. */
  myAnswer: number | null;
  /** How many players have answered the current question. */
  answeredCount: number;
  /** Once finished: what the caller earned from this game. */
  myReward: { rank: number | null; coins: number; xp: number } | null;
  players: {
    id: string;
    /** The account behind this player — used to derive a default avatar. */
    userId: string;
    name: string;
    score: number;
    avatarOptions: AvatarOptions | null;
    equippedItemId: string | null;
  }[];
}

export interface LeaderboardRow {
  id: string;
  /** Data-URI avatar image. */
  avatar?: string;
  rank: number;
  name: string;
  score: number;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  streak: number;
  connected: boolean;
}

export interface Class {
  id: string;
  name: string;
  code: string;
  teacherId: string;
  teacherName: string;
  /** One of CLASS_COLORS' keys, see src/lib/classColor.ts. */
  color: string;
  description: string | null;
  /** Set once an admin archives the group: it drops out of the main list
   * and no new work (assignments, submissions, files, announcements) can be
   * added. */
  archivedAt: string | null;
  createdAt: string;
  /** Enrolled student count. Only populated by GET /classes/:id. */
  memberCount?: number;
  /** Whether the caller administers this group (owner/co-admin). Only
   * populated by GET /classes/:id. */
  canManage?: boolean;
}

export interface Material {
  id: string;
  classId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export interface PersonSummary {
  id: string;
  name: string;
  avatarOptions: AvatarOptions | null;
  equippedItemId: string | null;
}

export interface PostAuthor {
  id: string;
  name: string;
  avatarOptions: AvatarOptions | null;
  equippedItemId: string | null;
}

export interface PostComment {
  id: string;
  body: string;
  createdAt: string;
  author: PostAuthor;
  canDelete: boolean;
}

/** A group announcement with its comments. */
export interface ClassPost {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: PostAuthor;
  /** A file shared with the announcement (it is also in the group's materials). */
  attachment: { id: string; fileName: string; sizeBytes: number } | null;
  canDelete: boolean;
  comments: PostComment[];
}

export interface ClassPeople {
  /** Owner first, then any co-admins the owner appointed. */
  teachers: (PersonSummary & { isPrimary: boolean })[];
  students: PersonSummary[];
}

export interface GradeCell {
  score: number | null;
  submittedAt: string;
  late: boolean;
}

/** Admin's members × assignments table. */
export interface ClassGrades {
  assignments: { id: string; title: string; dueAt: string | null }[];
  students: {
    id: string;
    name: string;
    cells: Record<string, GradeCell | null>;
    /** Mean of graded scores, null if none yet. */
    average: number | null;
  }[];
}

export interface Assignment {
  id: string;
  classId: string;
  /** Null for a plain, quiz-less classwork item — no auto-grading. */
  quizId: string | null;
  /** Null when no file was attached at creation. */
  materialId: string | null;
  title: string;
  /** Instructions for members; null when the admin wrote none. */
  description: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Populated for students by the list endpoint, so a "Done" badge can
   * show without opening every assignment. Undefined for teachers. */
  mySubmission?: { score: number | null; submittedAt: string } | null;
  /** Populated for the teacher by the list endpoint: how many students
   * have submitted so far. Undefined for students. */
  submissionCount?: number;
}

export interface AssignmentDetail extends Assignment {
  /** Null for a quiz-less assignment. A member gets the answers only once
   * their result is final (deadline passed, or the group archived). */
  quiz: Quiz | null;
  mySubmission?: Submission | null;
  /** Per question, whether the caller's submitted answer was right. */
  myCorrect?: boolean[] | null;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  answers: (number | null)[];
  /** Null until graded — always the case for a quiz-less assignment unless
   * the teacher enters a grade manually. */
  score: number | null;
  /** The member's own attached file, if they added one. */
  materialId: string | null;
  submittedAt: string;
  /** Submitted after the due date. Only set by the admin's list endpoint. */
  late?: boolean;
}

export interface SubmitResult {
  /** XP/coins granted for this (first) completion, if any. */
  reward?: { coins: number; xp: number };
  /** Null for a quiz-less assignment — nothing to auto-score. */
  score: number | null;
  correctCount: number | null;
  totalQuestions: number;
}

export type ShopItemCategory = 'avatarPreset';

export interface ShopItem {
  id: string;
  name: string;
  description: string | null;
  category: ShopItemCategory;
  value: string;
  price: number;
  /** Player level needed to buy it. */
  minLevel: number;
  createdAt: string;
  owned: boolean;
}

export interface PurchaseResult {
  item: Omit<ShopItem, 'owned'>;
  balance: number;
}

export interface BalanceInfo {
  balance: number;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

export interface StreakStatus {
  currentStreak: number;
  longestStreak: number;
  lastClaimedDate: string | null;
  canClaimToday: boolean;
  nextRewardPoints: number;
}

export interface ClaimResult {
  streakDay: number;
  pointsAwarded: number;
  balance: number;
}

export type PointTransactionType =
  | 'quiz_placement'
  | 'daily_streak'
  | 'shop_purchase'
  | 'admin_adjustment';

export interface PointTransaction {
  id: string;
  userId: string;
  amount: number;
  type: PointTransactionType;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
}

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload;
  constructor(message: string, status: number, payload: ApiErrorPayload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

// --- Community features ---------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  xp: number;
  level: number;
  avatarOptions: AvatarOptions | null;
  equippedItemId: string | null;
  isMe: boolean;
}

export interface LeaderboardResponse {
  scope: 'global' | 'class';
  rows: LeaderboardEntry[];
  /** The caller's own standing (rank is null if they opted out of the global list). */
  me: { rank: number | null; xp: number; level: number };
}

export interface BadgeItem {
  key: string;
  emoji: string;
  name: string;
  hint: string;
  earned: boolean;
  earnedAt: string | null;
}

export interface LibraryItem {
  id: string;
  title: string;
  questionCount: number;
  copyCount: number;
  publishedAt: string | null;
  authorName: string;
  /** First couple of question prompts, as a teaser. */
  sample: string[];
  mine: boolean;
  copied: boolean;
}
