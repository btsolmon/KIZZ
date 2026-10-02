'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LeaderboardList } from '@/components/LeaderboardList';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Shell, View } from '@/components/Shell';
import { EmptyState, LinkButton, SkeletonList } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cx } from '@/lib/cx';
import type { Class, LeaderboardResponse } from '@/lib/types';

export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <Shell activePath="">
          <LoadingScreen />
        </Shell>
      }
    >
      <Leaderboard />
    </Suspense>
  );
}

function Leaderboard() {
  const { user, ready } = useAuth();
  const searchParams = useSearchParams();
  const [classes, setClasses] = useState<Class[]>([]);
  // 'global' or a class id; `?group=<id>` opens straight on that group.
  const [scope, setScope] = useState<string>(() => searchParams.get('group') || 'global');
  const [data, setData] = useState<LeaderboardResponse | null>(null);

  useEffect(() => {
    if (!user) return;
    api.myClasses().then(setClasses).catch(() => setClasses([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    (scope === 'global' ? api.getLeaderboard('global') : api.getLeaderboard('class', scope))
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ scope: 'global', rows: [], me: { rank: null, xp: 0, level: 1 } });
      });
    return () => {
      cancelled = true;
    };
  }, [user, scope]);

  if (!ready) {
    return (
      <Shell activePath="">
        <LoadingScreen />
      </Shell>
    );
  }
  if (!user) {
    return (
      <Shell activePath="">
        <View narrow>
          <EmptyState title="Эхлээд нэвтэрнэ үү">
            <p>Тэргүүлэгчдийг харахын тулд нэвтрэх шаардлагатай.</p>
            <LinkButton href="/login" variant="primary" className="mt-4">
              Нэвтрэх / Бүртгүүлэх →
            </LinkButton>
          </EmptyState>
        </View>
      </Shell>
    );
  }

  const tabs = [{ id: 'global', label: 'Бүгд' }, ...classes.map((c) => ({ id: c.id, label: c.name }))];
  const meOutside = data?.me.rank && !data.rows.some((r) => r.isMe);

  return (
    <Shell activePath="">
      <View narrow>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Тэргүүлэгчид</h1>
        <p className="mt-1 text-ink-soft">XP-ээр эрэмбэлсэн. Тоглоом, даалгавар, урамшуулалаар XP цуглуул.</p>

        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Жагсаалтын төрөл">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={scope === t.id}
              onClick={() => setScope(t.id)}
              className={cx(
                'max-w-48 truncate rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                scope === t.id
                  ? 'border-transparent bg-ink text-paper'
                  : 'border-line bg-paper-raised text-ink hover:border-ink/30',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {!data ? (
            <SkeletonList rows={5} />
          ) : data.rows.length === 0 ? (
            <EmptyState title="Хоосон байна">
              <p>Одоохондоо жагсаалтад хэн ч алга.</p>
            </EmptyState>
          ) : (
            <>
              <LeaderboardList rows={data.rows} />
              {meOutside && (
                <p className="mt-4 text-center text-sm text-ink-soft">
                  Таны байр: <span className="font-bold text-ink">#{data.me.rank}</span> · {data.me.xp} XP
                </p>
              )}
              {scope === 'global' && data.me.rank === null && (
                <p className="mt-4 text-center text-sm text-ink-soft">
                  Та жагсаалтад харагдахгүй байна. Профайлын тохиргоогоос идэвхжүүлж болно.
                </p>
              )}
            </>
          )}
        </div>
      </View>
    </Shell>
  );
}
