'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LeaderboardList } from '@/components/LeaderboardList';
import { api } from '@/lib/api';
import type { LeaderboardResponse } from '@/lib/types';

const SHOWN = 3;

/** The group's top members by XP, linking to the full ranking. */
export function GroupLeaderboard({ classId }: { classId: string }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLeaderboard('class', classId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const rows = data?.rows.slice(0, SHOWN) ?? [];
  const meOutside = data?.me.rank && !rows.some((r) => r.isMe);

  return (
    <div className="rounded-md border-[2.5px] border-ink bg-paper-raised p-5 shadow-pop-md">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[17px] font-bold text-ink">Тэргүүлэгчид</h3>
        <Link
          href={`/leaderboard?group=${classId}`}
          className="shrink-0 text-[13px] font-semibold text-violet hover:underline"
        >
          Бүгд →
        </Link>
      </div>
      {!data ? (
        <p className="mt-2 text-[13px] text-ink-soft">Ачаалж байна...</p>
      ) : (
        <div className="mt-3">
          <LeaderboardList rows={rows} compact />
          {meOutside && (
            <p className="mt-2 text-center text-[12px] text-ink-soft">
              Таны байр: <span className="font-bold text-ink">#{data.me.rank}</span> · {data.me.xp} XP
            </p>
          )}
        </div>
      )}
    </div>
  );
}
