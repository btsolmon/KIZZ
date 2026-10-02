import { NextResponse } from 'next/server';
import { count, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classMembers, classes, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { getClassMembership } from '@/lib/access';
import { deleteClassCascade } from '@/lib/deletion';
import { toClass } from '@/lib/mappers';
import { isClassColorKey } from '@/lib/classColor';
import { optionalText } from '@/lib/text';
import { isUuid } from '@/lib/uuid';

const MAX_DESCRIPTION = 500;

type Params = { params: Promise<{ classId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass, isMember, isTeacher } = await getClassMembership(
    classId,
    auth.user.id,
  );
  if (!klass || !isMember) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }

  const db = getDb();
  const [owner, [{ value: memberCount }]] = await Promise.all([
    klass.teacherId === auth.user.id
      ? { name: auth.user.name }
      : db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, klass.teacherId))
          .limit(1)
          .then((rows) => rows[0]),
    db
      .select({ value: count() })
      .from(classMembers)
      .where(eq(classMembers.classId, classId)),
  ]);
  const teacherName = owner?.name ?? '';

  return NextResponse.json(toClass(klass, teacherName, {
      memberCount,
      canManage: isTeacher,
    }));
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass, isTeacher } = await getClassMembership(classId, auth.user.id);
  if (!klass) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }
  if (!isTeacher) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийн админ засах боломжтой.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
  }

  const db = getDb();
  const patch: Partial<typeof classes.$inferInsert> = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'Ангийн нэрээ оруулна уу.' },
        { status: 400 },
      );
    }
    patch.name = name;
  }
  if ('color' in body) {
    if (!isClassColorKey(body.color)) {
      return NextResponse.json({ error: 'Өнгө буруу байна.' }, { status: 400 });
    }
    patch.color = body.color;
  }
  if ('description' in body) {
    const description = optionalText(body.description);
    if (description && description.length > MAX_DESCRIPTION) {
      return NextResponse.json(
        { error: `Тайлбар ${MAX_DESCRIPTION} тэмдэгтээс ихгүй байх ёстой.` },
        { status: 400 },
      );
    }
    patch.description = description;
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      return NextResponse.json({ error: 'Буруу хүсэлт.' }, { status: 400 });
    }
    if (klass.teacherId !== auth.user.id) {
      return NextResponse.json(
        { error: 'Зөвхөн бүлгийг үүсгэсэн хүн архивлах боломжтой.' },
        { status: 403 },
      );
    }
    patch.archivedAt = body.archived ? (klass.archivedAt ?? new Date()) : null;
  }

  const [row] =
    Object.keys(patch).length === 0
      ? [klass]
      : await db
          .update(classes)
          .set(patch)
          .where(eq(classes.id, classId))
          .returning();

  const [{ value: memberCount }] = await db
    .select({ value: count() })
    .from(classMembers)
    .where(eq(classMembers.classId, classId));

  const [owner] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.teacherId))
    .limit(1);

  return NextResponse.json(
    toClass(row, owner?.name ?? '', {
      memberCount,
      canManage: true,
    }),
  );
}

/** Owner only: deletes the group and everything in it. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass } = await getClassMembership(classId, auth.user.id);
  if (!klass) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }
  if (klass.teacherId !== auth.user.id) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийг үүсгэсэн хүн устгах боломжтой.' },
      { status: 403 },
    );
  }

  await deleteClassCascade(classId);
  return NextResponse.json({ ok: true });
}
