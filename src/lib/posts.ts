import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classMaterials, classPostComments, classPosts, users } from '@/db/schema';
import type { ClassPost } from '@/lib/types';

export const MAX_POST_LENGTH = 2000;
export const MAX_COMMENT_LENGTH = 1000;
/** Unpinned announcements per page; "load more" asks for a bigger `limit`. */
export const POST_PAGE = 20;
const MAX_POST_LIMIT = 200;

const authorCols = {
  id: users.id,
  name: users.name,
  avatarOptions: users.avatarOptions,
  equippedItemId: users.equippedItemId,
};

/** `?limit=` from a request, clamped to something sane. */
export function parsePostLimit(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_POST_LIMIT) : POST_PAGE;
}

function postsQuery(classId: string, pinned: boolean) {
  return getDb()
    .select({
      post: classPosts,
      author: authorCols,
      // Never the file bytes, only what the link shows.
      fileName: classMaterials.fileName,
      fileSize: classMaterials.sizeBytes,
    })
    .from(classPosts)
    .innerJoin(users, eq(classPosts.authorId, users.id))
    .leftJoin(classMaterials, eq(classMaterials.id, classPosts.materialId))
    .where(and(eq(classPosts.classId, classId), eq(classPosts.pinned, pinned)))
    .orderBy(desc(classPosts.createdAt));
}

/** A group's announcements with their comments: every pinned one, then the
 * `limit` newest of the rest. `canManage` = the viewer is a group admin (may
 * delete anything). */
export async function loadPosts(
  classId: string,
  viewerId: string,
  canManage: boolean,
  limit = POST_PAGE,
): Promise<ClassPost[]> {
  const [pinned, recent] = await Promise.all([
    postsQuery(classId, true),
    postsQuery(classId, false).limit(limit),
  ]);
  const posts = [...pinned, ...recent];
  if (posts.length === 0) return [];

  const comments = await getDb()
    .select({ comment: classPostComments, author: authorCols })
    .from(classPostComments)
    .innerJoin(users, eq(classPostComments.authorId, users.id))
    .where(inArray(classPostComments.postId, posts.map((p) => p.post.id)))
    .orderBy(asc(classPostComments.createdAt));

  return posts.map(({ post, author, fileName, fileSize }) => ({
    id: post.id,
    body: post.body,
    pinned: post.pinned,
    createdAt: post.createdAt.toISOString(),
    author,
    attachment:
      post.materialId && fileName !== null && fileSize !== null
        ? { id: post.materialId, fileName, sizeBytes: fileSize }
        : null,
    canDelete: canManage || post.authorId === viewerId,
    comments: comments
      .filter((c) => c.comment.postId === post.id)
      .map(({ comment, author: a }) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
        author: a,
        canDelete: canManage || comment.authorId === viewerId,
      })),
  }));
}
