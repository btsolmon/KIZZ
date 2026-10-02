import { authStorage } from './authStorage';
import { ApiError } from './types';
import type { AvatarOptions } from './avatar';
import type {
  Assignment,
  AssignmentDetail,
  BalanceInfo,
  ClaimResult,
  Class,
  BadgeItem,
  ClassGrades,
  ClassPost,
  LeaderboardResponse,
  LibraryItem,
  ClassPeople,
  GameSession,
  GameState,
  Group,
  Material,
  AppNotification,
  Note,
  NoteAttachment,
  PointTransaction,
  PurchaseResult,
  Question,
  Quiz,
  QuizCheckResult,
  ShopItem,
  StreakStatus,
  Submission,
  SubmitResult,
  User,
} from './types';

const BASE = '/api';

const NETWORK_ERROR = 'Сүлжээнд холбогдож чадсангүй. Интернэтээ шалгаад дахин оролдоно уу.';
const SERVER_ERROR = 'Серверт алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';

/** fetch() that turns a dropped connection into an ApiError with a readable
 * message (otherwise it surfaces as an opaque TypeError). */
async function safeFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(NETWORK_ERROR, 0, { error: NETWORK_ERROR });
  }
}

/** The message to show for a failed response: the server's own if it sent
 * one, otherwise something sensible for the status. */
function failure(res: Response, data: { message?: string; error?: string }, fallback: string): ApiError {
  const message =
    data.message || data.error || (res.status >= 500 ? SERVER_ERROR : fallback);
  return new ApiError(message, res.status, { ...data, error: data.error ?? message });
}

function authHeaders(): Record<string, string> {
  const token = authStorage.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await safeFetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res, data, 'Алдаа гарлаа');
  return data as T;
}

/** POST a file as multipart/form-data. Content-Type is left for the browser
 * to set (it needs to add the multipart boundary), unlike `request`. */
async function uploadFile<T>(path: string, file: File): Promise<T> {
  return postForm<T>(path, {}, file);
}

/** POST arbitrary string fields plus an optional file as one
 * multipart/form-data request — used where a form has both regular fields
 * and an optional attachment (e.g. creating an assignment). */
async function postForm<T>(
  path: string,
  fields: Record<string, string | undefined>,
  file?: File | null,
): Promise<T> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.append(key, value);
  }
  if (file) formData.append('file', file);
  const res = await safeFetch(BASE + path, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure(res, data, 'Илгээхэд алдаа гарлаа');
  return data as T;
}

/** GET a binary response as a Blob, for a route that can't be reached via a
 * plain `<a href>` because auth here is a bearer token, not a cookie — a
 * top-level navigation wouldn't carry the Authorization header. */
async function downloadFile(path: string): Promise<{ blob: Blob; fileName: string }> {
  const res = await safeFetch(BASE + path, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw failure(res, data, 'Татахад алдаа гарлаа');
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const starMatch = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const plainMatch = /filename="?([^";]+)"?/.exec(disposition);
  const fileName = starMatch
    ? decodeURIComponent(starMatch[1])
    : (plainMatch?.[1] ?? 'file');
  return { blob: await res.blob(), fileName };
}

export const api = {
  // auth
  signup: (payload: { name: string; email: string; password: string }) =>
    request<{ token: string; user: User }>('POST', '/auth/signup', payload),
  login: (payload: { email: string; password: string }) =>
    request<{ token: string; user: User }>('POST', '/auth/login', payload),
  logout: () => request('POST', '/auth/logout'),
  me: () => request<User>('GET', '/auth/me'),
  updateProfile: (patch: { name?: string; showOnLeaderboard?: boolean }) =>
    request<User>('PATCH', '/me/profile', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('POST', '/me/password', { currentPassword, newPassword }),
  deleteAccount: (password: string) => request('DELETE', '/me', { password }),
  equipAvatar: (itemId: string | null) =>
    request<{ equippedItemId: string | null }>('PUT', '/me/avatar/equip', { itemId }),
  updateAvatar: (options: AvatarOptions) =>
    request<{ avatarOptions: AvatarOptions }>('PATCH', '/me/avatar', options),

  // groups
  createGroup: (name: string) => request<Group>('POST', '/groups', { name }),
  joinGroup: (code: string) => request<Group>('POST', '/groups/join', { code }),

  // notes
  listNotes: (groupId: string) => request<Note[]>('GET', `/groups/${groupId}/notes`),
  createNote: (groupId: string, title: string) =>
    request<Note>('POST', `/groups/${groupId}/notes`, { title }),
  listClassNotes: (classId: string) =>
    request<Note[]>('GET', `/classes/${classId}/notes`),
  createClassNote: (classId: string, title: string) =>
    request<Note>('POST', `/classes/${classId}/notes`, { title }),
  listMyNotes: () => request<Note[]>('GET', '/me/notes'),
  createMyNote: (title: string) => request<Note>('POST', '/me/notes', { title }),
  listMyQuizzes: () => request<Quiz[]>('GET', '/me/quizzes'),
  deleteNote: (noteId: string) => request('DELETE', `/notes/${noteId}`),
  getNote: (noteId: string) => request<Note>('GET', `/notes/${noteId}`),
  updateNote: (noteId: string, patch: { title?: string; content?: string; baseUpdatedAt?: string }) =>
    request<Note>('PATCH', `/notes/${noteId}`, patch),

  // quizzes
  generateQuiz: (noteId: string, count: number) =>
    request<Quiz>('POST', `/notes/${noteId}/generate-quiz`, { count }),
  listQuizzes: (groupId: string) => request<Quiz[]>('GET', `/groups/${groupId}/quizzes`),
  listClassQuizzes: (classId: string) =>
    request<Quiz[]>('GET', `/classes/${classId}/quizzes`),
  deleteQuiz: (quizId: string) => request('DELETE', `/quizzes/${quizId}`),
  updateQuiz: (
    quizId: string,
    patch: { title?: string; questions?: Question[]; isPublic?: boolean },
  ) =>
    request<Quiz>('PATCH', `/quizzes/${quizId}`, patch),
  // community
  getLeaderboard: (scope: 'global' | 'class', classId?: string) =>
    request<LeaderboardResponse>(
      'GET',
      `/leaderboard?scope=${scope}${classId ? `&classId=${classId}` : ''}`,
    ),
  getMyBadges: () => request<{ badges: BadgeItem[] }>('GET', '/me/badges'),
  listLibrary: (q: string, sort: 'new' | 'popular') =>
    request<{ items: LibraryItem[] }>(
      'GET',
      `/library?sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  copyLibraryQuiz: (quizId: string) => request<Quiz>('POST', `/library/${quizId}/copy`),
  /** Pinned announcements plus the `limit` newest others. */
  listPosts: (classId: string, limit: number) =>
    request<ClassPost[]>('GET', `/classes/${classId}/posts?limit=${limit}`),
  createPost: (classId: string, body: string, file?: File | null) =>
    postForm<ClassPost[]>(`/classes/${classId}/posts`, { body }, file),
  pinPost: (postId: string, pinned: boolean) =>
    request('PATCH', `/posts/${postId}`, { pinned }),
  deletePost: (postId: string) => request('DELETE', `/posts/${postId}`),
  addComment: (postId: string, body: string) =>
    request('POST', `/posts/${postId}/comments`, { body }),
  deleteComment: (commentId: string) => request('DELETE', `/comments/${commentId}`),
  getQuiz: (quizId: string) => request<Quiz>('GET', `/quizzes/${quizId}`),
  /** Practice on a quiz whose answers are hidden from the caller. */
  checkQuiz: (quizId: string, answers: { questionId: string; optionIndex: number | null }[]) =>
    request<{ results: QuizCheckResult[] }>('POST', `/quizzes/${quizId}/check`, { answers }),

  // live game — polling-based (no WebSocket/pub-sub service is configured
  // anywhere in this repo). Poll getGameState every ~1.5s while on the play
  // screen; every mutating call below returns the fresh GameState too, so
  // the caller can apply it immediately without waiting for the next poll.
  createGame: (quizId: string) => request<GameSession>('POST', '/games', { quizId }),
  lookupGameByCode: (code: string) => request<GameSession>('GET', `/games/code/${code}`),
  joinGame: (id: string) => request<GameState>('POST', `/games/${id}/join`),
  leaveGame: (id: string) => request<GameState>('DELETE', `/games/${id}/join`),
  getGameState: (id: string) => request<GameState>('GET', `/games/${id}/state`),
  startGame: (id: string) => request<GameState>('POST', `/games/${id}/start`),
  answerGame: (id: string, optionIndex: number) =>
    request<GameState>('POST', `/games/${id}/answer`, { optionIndex }),
  revealGame: (id: string) => request<GameState>('POST', `/games/${id}/reveal`),
  nextGame: (id: string) => request<GameState>('POST', `/games/${id}/next`),
  endGame: (id: string) => request<{ ended: boolean }>('POST', `/games/${id}/end`),
  /** Fire-and-forget end for a closing tab — `keepalive` lets it outlive the page. */
  endGameOnExit: (id: string) => {
    void fetch(`${BASE}/games/${id}/end`, {
      method: 'POST',
      headers: authHeaders(),
      keepalive: true,
    }).catch(() => {});
  },

  // classroom
  myClasses: () => request<Class[]>('GET', '/me/classes'),
  createClass: (payload: {
    name: string;
    color?: string;
    description?: string;
  }) => request<Class>('POST', '/classes', payload),
  updateClass: (
    id: string,
    patch: Partial<{
      name: string;
      color: string;
      description: string | null;
      /** Owner only. */
      archived: boolean;
    }>,
  ) => request<Class>('PATCH', `/classes/${id}`, patch),
  resetClassCode: (id: string) =>
    request<{ code: string }>('POST', `/classes/${id}/code`),
  // Teachers can also join another teacher's class by code, as a
  // full co-teacher — same call, the backend branches on role.
  joinClass: (code: string) => request<Class>('POST', '/classes/join', { code }),
  getClass: (id: string) => request<Class>('GET', `/classes/${id}`),
  getPeople: (classId: string) =>
    request<ClassPeople>('GET', `/classes/${classId}/people`),
  setMemberAdmin: (classId: string, userId: string, admin: boolean) =>
    request('PATCH', `/classes/${classId}/members/${userId}`, { admin }),
  removeMember: (classId: string, userId: string) =>
    request('DELETE', `/classes/${classId}/members/${userId}`),
  listMaterials: (classId: string) =>
    request<Material[]>('GET', `/classes/${classId}/materials`),
  uploadMaterial: (classId: string, file: File) =>
    uploadFile<Material>(`/classes/${classId}/materials`, file),
  downloadMaterial: (materialId: string) =>
    downloadFile(`/materials/${materialId}`),
  deleteMaterial: (materialId: string) =>
    request('DELETE', `/materials/${materialId}`),
  listNotifications: () =>
    request<{ items: AppNotification[]; unread: number }>('GET', '/notifications'),
  markNotificationsRead: () => request('POST', '/notifications/read'),
  markNotificationRead: (id: string) => request('PATCH', `/notifications/${id}`),
  deleteNotification: (id: string) => request('DELETE', `/notifications/${id}`),
  clearNotifications: () => request('DELETE', '/notifications'),
  listNoteAttachments: (noteId: string) =>
    request<NoteAttachment[]>('GET', `/notes/${noteId}/attachments`),
  uploadNoteAttachment: (noteId: string, file: File) =>
    uploadFile<NoteAttachment>(`/notes/${noteId}/attachments`, file),
  downloadNoteAttachment: (attachmentId: string) =>
    downloadFile(`/note-attachments/${attachmentId}`),
  deleteNoteAttachment: (attachmentId: string) =>
    request('DELETE', `/note-attachments/${attachmentId}`),
  updateAssignment: (
    assignmentId: string,
    patch: { title?: string; description?: string | null; dueAt?: string | null },
  ) => request<Assignment>('PATCH', `/assignments/${assignmentId}`, patch),
  getGrades: (classId: string) =>
    request<ClassGrades>('GET', `/classes/${classId}/grades`),
  deleteAssignment: (assignmentId: string) =>
    request('DELETE', `/assignments/${assignmentId}`),
  deleteClass: (classId: string) => request('DELETE', `/classes/${classId}`),
  leaveClass: (classId: string) =>
    request('DELETE', `/classes/${classId}/membership`),
  listAssignments: (classId: string) =>
    request<Assignment[]>('GET', `/classes/${classId}/assignments`),
  createAssignment: (
    classId: string,
    payload: {
      title: string;
      description?: string;
      dueAt: string | null;
      /** Optional — an assignment can have no quiz (plain instructional
       * item, no auto-grading). */
      quizId?: string;
      /** Optional — a file to attach, uploaded in the same request. */
      file?: File | null;
    },
  ) =>
    postForm<Assignment>(
      `/classes/${classId}/assignments`,
      {
        title: payload.title,
        description: payload.description,
        dueAt: payload.dueAt ?? undefined,
        quizId: payload.quizId,
      },
      payload.file,
    ),
  getAssignment: (id: string) => request<AssignmentDetail>('GET', `/assignments/${id}`),
  submitAssignment: (
    id: string,
    payload: {
      answers: (number | null)[];
      /** Optional — the member's own work. Replaces one sent earlier. */
      file?: File | null;
    },
  ) =>
    postForm<SubmitResult>(
      `/assignments/${id}/submit`,
      { answers: JSON.stringify(payload.answers) },
      payload.file,
    ),
  listSubmissions: (assignmentId: string) =>
    request<Submission[]>('GET', `/assignments/${assignmentId}/submissions`),
  /** Nudges members who haven't handed it in (once a day per member). */
  remindAssignment: (assignmentId: string) =>
    request<{ reminded: number; missing: number }>('POST', `/assignments/${assignmentId}/remind`),
  gradeSubmission: (submissionId: string, score: number) =>
    request<Submission>('PATCH', `/submissions/${submissionId}`, { score }),

  // points / gamification
  getBalance: () => request<BalanceInfo>('GET', '/points/balance'),
  getPointsHistory: (page = 1) =>
    request<{ history: PointTransaction[]; page: number; pageSize: number }>(
      'GET',
      `/points/history?page=${page}`
    ),
  getStreakStatus: () => request<StreakStatus>('GET', '/streak'),
  claimStreak: () => request<ClaimResult>('POST', '/streak/claim'),
  listShopItems: () => request<{ items: ShopItem[] }>('GET', '/shop/items'),
  purchaseItem: (itemId: string) =>
    request<PurchaseResult>('POST', '/shop/purchase', { itemId }),
  getInventory: () => request<{ items: ShopItem[] }>('GET', '/inventory'),
};
