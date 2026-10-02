import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classMembers, classes, users } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { getClassMembership } from '@/lib/access';
import { notifyUsers } from '@/lib/notifications';
import { grantBadge } from '@/lib/points/badges';
import { toClass } from '@/lib/mappers';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const code =
    typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) {
    return NextResponse.json(
      { error: 'Ангийн кодоо оруулна уу.' },
      { status: 400 },
    );
  }

  const db = getDb();
  const [klass] = await db
    .select()
    .from(classes)
    .where(eq(classes.code, code))
    .limit(1);
  if (!klass) {
    return NextResponse.json({ error: 'Код буруу байна.' }, { status: 404 });
  }

  if (klass.teacherId === auth.user.id) {
    return NextResponse.json(
      { error: 'Энэ бол таны өөрийн бүлэг.' },
      { status: 400 },
    );
  }
  const { isMember } = await getClassMembership(klass.id, auth.user.id);
  if (!isMember && klass.archivedAt) {
    return NextResponse.json(
      { error: 'Энэ бүлэг архивлагдсан тул нэгдэх боломжгүй.' },
      { status: 409 },
    );
  }
  if (!isMember) {
    await db
      .insert(classMembers)
      .values({ classId: klass.id, studentId: auth.user.id });
    await grantBadge(db, auth.user.id, 'team_player');
    await notifyUsers([klass.teacherId], {
      title: `${auth.user.name} бүлэгт нэгдлээ`,
      body: klass.name,
      href: `/classroom?classId=${klass.id}`,
    });
  }

  const [teacher] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, klass.teacherId))
    .limit(1);

  return NextResponse.json(toClass(klass, teacher?.name ?? ''));
}
