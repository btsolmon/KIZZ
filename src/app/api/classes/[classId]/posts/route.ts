import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classMaterials, classPosts } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { archivedGuard, getClassMembership } from '@/lib/access';
import { fileHasValidSignature } from '@/lib/fileSignature';
import { insertMaterial, validateMaterialFile } from '@/lib/materials';
import { classStudentIds, notifyUsers } from '@/lib/notifications';
import { MAX_POST_LENGTH, loadPosts, parsePostLimit } from '@/lib/posts';
import { rateLimit } from '@/lib/rateLimit';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ classId: string }> };

/** Pinned announcements plus the `?limit=` newest others (default 20). */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });

  const { klass, isMember, isTeacher } = await getClassMembership(classId, auth.user.id);
  if (!klass || !isMember) return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  const limit = parsePostLimit(new URL(request.url).searchParams.get('limit'));
  return NextResponse.json(await loadPosts(classId, auth.user.id, isTeacher, limit));
}

/** The text and optional file from either a JSON body (`{ body }`) or
 * multipart form data (`body`, plus `file`). */
async function readPost(request: Request): Promise<{ body: string; file: File | null }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    const body = form?.get('body');
    const file = form?.get('file');
    return {
      body: typeof body === 'string' ? body.trim() : '',
      // An empty file input still shows up as a 0-byte File in some browsers.
      file: file instanceof File && file.size > 0 ? file : null,
    };
  }
  const payload = await request.json().catch(() => null);
  return { body: typeof payload?.body === 'string' ? payload.body.trim() : '', file: null };
}

/** Admins post an announcement, optionally with a file; members are
 * notified. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });

  const { klass, isTeacher } = await getClassMembership(classId, auth.user.id);
  if (!klass) return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  if (!isTeacher) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийн админ зарлал нийтлэх боломжтой.' },
      { status: 403 },
    );
  }
  const archived = archivedGuard(klass);
  if (archived) return archived;
  const limited = rateLimit(`post:${auth.user.id}`, 20, 10 * 60_000);
  if (limited) return limited;

  const { body, file } = await readPost(request);
  if (!body && !file) {
    return NextResponse.json({ error: 'Зарлалын текстээ бичнэ үү.' }, { status: 400 });
  }
  if (body.length > MAX_POST_LENGTH) {
    return NextResponse.json(
      { error: `Зарлал ${MAX_POST_LENGTH} тэмдэгтээс ихгүй байх ёстой.` },
      { status: 400 },
    );
  }

  // The file is shared with the whole group, so it also shows in Материал.
  let materialId: string | null = null;
  if (file) {
    const invalid = validateMaterialFile(file);
    if (invalid) {
      return NextResponse.json({ error: invalid.error }, { status: invalid.status });
    }
    if (!(await fileHasValidSignature(file))) {
      return NextResponse.json(
        { error: 'Файлын агуулга төрөлтэйгээ таарахгүй байна.' },
        { status: 415 },
      );
    }
    const uploadLimited = rateLimit(`upload:${auth.user.id}`, 30, 10 * 60_000);
    if (uploadLimited) return uploadLimited;
    materialId = (await insertMaterial({ classId, uploadedBy: auth.user.id, file })).id;
  }

  try {
    await getDb().insert(classPosts).values({ classId, authorId: auth.user.id, body, materialId });
  } catch (err) {
    if (materialId) await getDb().delete(classMaterials).where(eq(classMaterials.id, materialId));
    throw err;
  }
  await notifyUsers(await classStudentIds(classId), {
    title: `📣 ${klass.name}: шинэ зарлал`,
    body: !body ? `📎 ${file!.name}` : body.length > 80 ? `${body.slice(0, 80)}…` : body,
    href: `/classroom?classId=${classId}`,
  });
  return NextResponse.json(await loadPosts(classId, auth.user.id, true), { status: 201 });
}
