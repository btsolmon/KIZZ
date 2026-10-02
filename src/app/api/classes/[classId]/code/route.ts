import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classes } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { getClassMembership } from '@/lib/access';
import { generateUniqueCode } from '@/lib/codes';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ classId: string }> };

/** Owner only: replaces the join code, e.g. after it leaked. The old code
 * stops working; current members stay. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { classId } = await params;
  if (!isUuid(classId)) {
    return NextResponse.json({ error: 'Олдсонгүй.' }, { status: 404 });
  }

  const { klass, isMember } = await getClassMembership(classId, auth.user.id);
  if (!klass || !isMember) {
    return NextResponse.json({ error: 'Бүлэг олдсонгүй.' }, { status: 404 });
  }
  if (klass.teacherId !== auth.user.id) {
    return NextResponse.json(
      { error: 'Зөвхөн бүлгийг үүсгэсэн хүн кодыг шинэчлэх боломжтой.' },
      { status: 403 },
    );
  }

  const db = getDb();
  const code = await generateUniqueCode(async (candidate) => {
    const [existing] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.code, candidate))
      .limit(1);
    return !existing;
  });
  await db.update(classes).set({ code }).where(eq(classes.id, classId));
  return NextResponse.json({ code });
}
