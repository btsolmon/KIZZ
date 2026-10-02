'use client';

import { useSearchParams } from 'next/navigation';
import { Shell, View } from '@/components/Shell';
import { LoadingScreen } from '@/components/LoadingScreen';
import { EmptyState, LinkButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import ClassList from './ClassList';
import ClassDetail, { type TabKey } from './ClassDetail';

const TAB_PARAMS: TabKey[] = [
  'stream',
  'classwork',
  'materials',
  'notes',
  'quiz',
  'people',
  'marks',
];

export default function ClassroomView() {
  const { user, ready } = useAuth();
  const searchParams = useSearchParams();
  const classId = searchParams.get('classId');
  const tab = searchParams.get('tab');

  if (!ready)
    return (
      <Shell activePath="/classroom">
        <LoadingScreen />
      </Shell>
    );

  if (!user) {
    return (
      <Shell activePath="/classroom">
        <View narrow>
          <EmptyState title="Эхлээд нэвтэрнэ үү">
            <p>Бүлгүүд ашиглахын тулд нэвтрэх шаардлагатай.</p>
            <LinkButton href="/login" variant="primary" className="mt-4">
              Нэвтрэх / Бүртгүүлэх →
            </LinkButton>
          </EmptyState>
        </View>
      </Shell>
    );
  }

  return (
    <Shell activePath="/classroom">
      {classId ? (
        <ClassDetail
          user={user}
          classId={classId}
          initialTab={TAB_PARAMS.find((t) => t === tab)}
        />
      ) : (
        <ClassList user={user} />
      )}
    </Shell>
  );
}
