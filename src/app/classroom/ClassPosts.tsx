'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Pin, PinOff, Trash2 } from 'lucide-react';
import { Button, Card, SkeletonList } from '@/components/ui';
import { AttachmentLink } from '@/components/AttachmentLink';
import { FilePicker } from '@/components/FilePicker';
import { api } from '@/lib/api';
import { avatarSrcFor } from '@/lib/avatar';
import { useConfirm } from '@/lib/confirm';
import { cx } from '@/lib/cx';
import { formatSize } from '@/lib/text';
import { useToast } from '@/lib/toast';
import type { ApiError, ClassPost, PostAuthor } from '@/lib/types';

const MAX_POST = 2000;
const MAX_COMMENT = 1000;
// Unpinned announcements per page — POST_PAGE in src/lib/posts.ts.
const PAGE = 20;

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'дөнгөж сая';
  if (minutes < 60) return `${minutes} мин өмнө`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} цагийн өмнө`;
  return `${Math.round(hours / 24)} өдрийн өмнө`;
}

function Author({ author, when }: { author: PostAuthor; when: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={avatarSrcFor(author)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink">{author.name}</p>
        <p className="text-xs text-ink-soft">{when}</p>
      </div>
    </div>
  );
}

function Composer({
  placeholder,
  max,
  submitLabel,
  onSubmit,
  compact = false,
  allowFile = false,
}: {
  placeholder: string;
  max: number;
  submitLabel: string;
  onSubmit: (body: string, file: File | null) => Promise<void>;
  compact?: boolean;
  /** Offer an optional file next to the text (a file alone is enough). */
  allowFile?: boolean;
}) {
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!body.trim() || !!file;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      await onSubmit(body.trim(), file);
      setBody('');
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        maxLength={max}
        rows={compact ? 2 : 3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full resize-y rounded-lg border border-line bg-paper p-3 text-[15px] text-ink outline-none focus:border-violet focus:ring-2 focus:ring-violet/15"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {allowFile && <FilePicker file={file} onChange={setFile} />}
          <span className="text-xs text-ink-soft">
            {body.length} / {max}
          </span>
        </div>
        <Button variant="primary" onClick={submit} disabled={busy || !ready}>
          {busy ? 'Илгээж байна...' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Announcements from the group's admins, with member comments. */
export function ClassPosts({
  classId,
  isAdmin,
  archived,
}: {
  classId: string;
  isAdmin: boolean;
  archived: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [posts, setPosts] = useState<ClassPost[] | null>(null);
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  // How many unpinned announcements to show; "load more" raises it. Every
  // reload fetches that many, so pins, comments and deletes stay in sync.
  const [limit, setLimit] = useState(PAGE);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      setPosts(await api.listPosts(classId, limit));
    } catch {
      // Keep what is already shown; only a first load ends up empty.
      setPosts((prev) => prev ?? []);
    } finally {
      setLoadingMore(false);
    }
  }, [classId, limit]);

  // A full page came back, so there may be older ones.
  const hasMore = !!posts && posts.filter((p) => !p.pinned).length >= limit;

  function loadMore() {
    setLoadingMore(true);
    setLimit((l) => l + PAGE); // the effect below fetches
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const fail = (err: unknown) =>
    toast((err as ApiError).payload?.error || 'Алдаа гарлаа', 'error');

  async function removePost(post: ClassPost) {
    if (!(await confirm({ message: 'Энэ зарлалыг устгах уу? Сэтгэгдлүүд нь хамт устна.', danger: true }))) return;
    try {
      await api.deletePost(post.id);
      await load();
    } catch (err) {
      fail(err);
    }
  }

  function toggleComments(id: string) {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section aria-label="Зарлал">
      <h3 className="mb-2.5 text-lg">Зарлал</h3>

      {isAdmin && !archived && (
        <Card className="mb-4 rounded-lg">
          <Composer
            placeholder="Бүлгийнхээ гишүүдэд зарлал бичих..."
            max={MAX_POST}
            submitLabel="Нийтлэх"
            allowFile
            onSubmit={async (body, file) => {
              try {
                // The response is the first page again.
                setPosts(await api.createPost(classId, body, file));
                setLimit(PAGE);
              } catch (err) {
                fail(err);
                throw err;
              }
            }}
          />
        </Card>
      )}

      {posts === null ? (
        <SkeletonList rows={2} />
      ) : posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-ink-soft">
          {isAdmin ? 'Анхны зарлалаа бичээрэй, гишүүдэд мэдэгдэл очно.' : 'Одоохондоо зарлал алга.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => {
            const open = openComments.has(post.id);
            return (
              <Card
                key={post.id}
                className={cx('rounded-lg', post.pinned && 'border-violet/50 bg-violet/5')}
              >
                <div className="flex items-start justify-between gap-3">
                  <Author author={post.author} when={timeAgo(post.createdAt)} />
                  <div className="flex shrink-0 items-center gap-1">
                    {post.pinned && (
                      <span className="mr-1 rounded-full bg-violet/15 px-2 py-0.5 text-[11px] font-semibold text-violet">
                        Бэхлэгдсэн
                      </span>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          api
                            .pinPost(post.id, !post.pinned)
                            .then(load)
                            .catch(fail)
                        }
                        aria-label={post.pinned ? 'Бэхлэлтийг авах' : 'Бэхлэх'}
                        title={post.pinned ? 'Бэхлэлтийг авах' : 'Бэхлэх'}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-ink/5 hover:text-ink"
                      >
                        {post.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                      </button>
                    )}
                    {post.canDelete && (
                      <button
                        type="button"
                        onClick={() => removePost(post)}
                        aria-label="Зарлал устгах"
                        title="Устгах"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-coral/10 hover:text-coral"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {post.body && (
                  <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-relaxed text-ink">
                    {post.body}
                  </p>
                )}
                {post.attachment && (
                  <div className="mt-3">
                    <AttachmentLink
                      materialId={post.attachment.id}
                      label={`${post.attachment.fileName} · ${formatSize(post.attachment.sizeBytes)}`}
                      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border-2 border-line px-3 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleComments(post.id)}
                  aria-expanded={open}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft hover:text-ink"
                >
                  <MessageCircle size={15} aria-hidden />
                  {post.comments.length > 0 ? `${post.comments.length} сэтгэгдэл` : 'Сэтгэгдэл бичих'}
                </button>

                {open && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                    {post.comments.map((c) => (
                      <div key={c.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Author author={c.author} when={timeAgo(c.createdAt)} />
                          <p className="mt-1.5 whitespace-pre-line break-words pl-[2.625rem] text-sm text-ink">
                            {c.body}
                          </p>
                        </div>
                        {c.canDelete && (
                          <button
                            type="button"
                            onClick={() =>
                              api
                                .deleteComment(c.id)
                                .then(load)
                                .catch(fail)
                            }
                            aria-label="Сэтгэгдэл устгах"
                            title="Устгах"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft/70 hover:bg-coral/10 hover:text-coral"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    <Composer
                      compact
                      placeholder="Сэтгэгдлээ бичих..."
                      max={MAX_COMMENT}
                      submitLabel="Илгээх"
                      onSubmit={async (body) => {
                        try {
                          await api.addComment(post.id, body);
                          await load();
                        } catch (err) {
                          fail(err);
                          throw err;
                        }
                      }}
                    />
                  </div>
                )}
              </Card>
            );
          })}
          {hasMore && (
            <Button variant="ghost" onClick={loadMore} disabled={loadingMore} className="self-center">
              {loadingMore ? 'Ачаалж байна...' : 'Өмнөх зарлалууд'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
