'use client';

import { useState } from 'react';
import { Pencil, RefreshCw, Users } from 'lucide-react';
import { Card } from '@/components/ui';
import { CopyCodeButton } from '@/components/CopyCodeButton';
import { classBannerClass } from '@/lib/classColor';
import { api } from '@/lib/api';
import { useConfirm } from '@/lib/confirm';
import { cx } from '@/lib/cx';
import { useToast } from '@/lib/toast';
import { ClassPosts } from './ClassPosts';
import { GroupLeaderboard } from './GroupLeaderboard';
import { Upcoming } from './Upcoming';
import type { ApiError, Assignment, Class } from '@/lib/types';

export function ClassStream({
  klass,
  assignments,
  isTeacher,
  isOwner,
  onEdit,
  onCodeReset,
}: {
  klass: Class;
  assignments: Assignment[];
  isTeacher: boolean;
  isOwner: boolean;
  onEdit: () => void;
  onCodeReset: (code: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [resetting, setResetting] = useState(false);

  async function resetCode() {
    if (
      !(await confirm({
        message: 'Шинэ код үүсгэх үү? Хуучин код ажиллахаа болино, одоогийн гишүүд хэвээр үлдэнэ.',
        confirmLabel: 'Шинэчлэх',
      }))
    )
      return;
    setResetting(true);
    try {
      const { code } = await api.resetClassCode(klass.id);
      onCodeReset(code);
      toast(`Шинэ код: ${code}`);
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Алдаа гарлаа', 'error');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cx(
          'overflow-hidden rounded-lg border-[2.5px] border-ink shadow-pop-md',
          classBannerClass(klass.color),
        )}
      >
        <div className="px-6 pb-6 pt-5 text-white">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-3xl font-extrabold leading-tight">
                {klass.name}
              </h2>
              {klass.description && (
                <p className="mt-1 max-w-prose whitespace-pre-line text-[14px] text-white/85">
                  {klass.description}
                </p>
              )}
              <p className="mt-1.5 flex items-center gap-1.5 text-white/85">
                {isTeacher ? (
                  <>
                    <Users size={15} /> {klass.memberCount ?? 0} гишүүн
                  </>
                ) : (
                  `Үүсгэсэн: ${klass.teacherName}`
                )}
              </p>
            </div>
            {isTeacher && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-white/40 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white/10"
              >
                <Pencil size={15} /> Тохируулах
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
        <Card className="self-start rounded-lg">
          <p className="text-[13px] font-semibold text-ink-soft">
            Бүлгийн код
          </p>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xl font-bold tracking-wide text-ink">
              {klass.code}
            </p>
            <CopyCodeButton code={klass.code} />
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={resetCode}
              disabled={resetting}
              className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={13} className={cx(resetting && 'animate-spin')} aria-hidden />
              Шинэ код үүсгэх
            </button>
          )}
        </Card>
        <Upcoming assignments={assignments} isTeacher={isTeacher} />
        <GroupLeaderboard classId={klass.id} />
      </div>

      <ClassPosts classId={klass.id} isAdmin={isTeacher} archived={!!klass.archivedAt} />
    </div>
  );
}
