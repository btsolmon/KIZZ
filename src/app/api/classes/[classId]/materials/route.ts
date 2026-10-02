import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { classMaterials } from '@/db/schema';
import { requireUser } from '@/lib/auth/requireUser';
import { archivedGuard, getClassMembership } from '@/lib/access';
import { classStudentIds, notifyUsers } from '@/lib/notifications';
import { fileHasValidSignature } from '@/lib/fileSignature';
import { rateLimit } from '@/lib/rateLimit';
import { toMaterial } from '@/lib/mappers';
import {
  insertMaterial,
  materialColumns,
  validateMaterialFile,
} from '@/lib/materials';
import { isUuid } from '@/lib/uuid';

type Params = { params: Promise<{ classId: string }> };

export async function GET(request: Request, { params }: Params) {
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

  const rows = await getDb()
    .select(materialColumns)
    .from(classMaterials)
    // Members' own submitted work is private to them and the admins.
    .where(and(eq(classMaterials.classId, classId), eq(classMaterials.isSubmission, false)))
    .orderBy(desc(classMaterials.createdAt));

  return NextResponse.json(rows.map(toMaterial));
}

export async function POST(request: Request, { params }: Params) {
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
      { error: 'Зөвхөн бүлгийн админ файл байршуулах боломжтой.' },
      { status: 403 },
    );
  }
  const archived = archivedGuard(klass);
  if (archived) return archived;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  const invalid = validateMaterialFile(file);
  if (invalid) {
    return NextResponse.json({ error: invalid.error }, { status: invalid.status });
  }

  if (!(await fileHasValidSignature(file as File))) {
    return NextResponse.json(
      { error: 'Файлын агуулга төрөлтэйгээ таарахгүй байна.' },
      { status: 415 },
    );
  }
  const limited = rateLimit(`upload:${auth.user.id}`, 30, 10 * 60_000);
  if (limited) return limited;

  const row = await insertMaterial({
    classId,
    uploadedBy: auth.user.id,
    file: file as File,
  });
  await notifyUsers(await classStudentIds(classId), {
    title: `Шинэ материал: ${row.fileName}`,
    body: `${klass.name} ангид`,
    href: `/classroom?classId=${classId}`,
  });
  return NextResponse.json(toMaterial(row), { status: 201 });
}
