'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ArrowLeft, LogOut, Trash2 } from 'lucide-react';
import { View } from '@/components/Shell';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Tabs } from '@/components/Tabs';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useConfirm } from '@/lib/confirm';
import { ClassStream } from './ClassStream';
import { ClassAssignments } from './ClassAssignments';
import { ClassMaterials } from './ClassMaterials';
import { ClassNotes } from './ClassNotes';
import { ClassQuiz } from './ClassQuiz';
import { ClassMarks } from './ClassMarks';
import { People } from './People';
import { EditClassDialog } from './EditClassDialog';
import type { ApiError, Assignment, Class, User } from '@/lib/types';

export type TabKey =
  | 'stream'
  | 'classwork'
  | 'materials'
  | 'notes'
  | 'quiz'
  | 'people'
  | 'marks';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'stream', label: 'Ерөнхий' },
  { key: 'classwork', label: 'Даалгавар' },
  { key: 'materials', label: 'Материал' },
  { key: 'notes', label: 'Тэмдэглэл' },
  { key: 'quiz', label: 'Quiz' },
  { key: 'people', label: 'Гишүүд' },
  { key: 'marks', label: 'Дүн' },
];

export default function ClassDetail({
  user,
  classId,
  initialTab,
}: {
  user: User;
  classId: string;
  initialTab?: TabKey;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [klass, setKlass] = useState<Class | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? 'stream');

  const isTeacher = klass?.canManage ?? false;

  async function reloadAssignments() {
    setAssignments(await api.listAssignments(classId));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getClass(classId), api.listAssignments(classId)])
      .then(([k, a]) => {
        if (cancelled) return;
        setKlass(k);
        setAssignments(a);
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        toast(err.payload?.error || 'Бүлэг олдсонгүй', 'error');
        router.push('/classroom');
      });
    return () => {
      cancelled = true;
    };
  }, [classId, router, toast]);

  const isOwner = klass?.teacherId === user.id;
  const archived = !!klass?.archivedAt;

  async function deleteGroup() {
    if (!klass) return;
    if (!(await confirm({ message: `"${klass.name}" бүлгийг устгах уу? Бүх тэмдэглэл, quiz, даалгавар, дүн устгагдана. Үүнийг буцаах боломжгүй.`, danger: true }))) return;
    try {
      await api.deleteClass(classId);
      toast('Бүлэг устгагдлаа');
      router.push('/classroom');
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Устгахад алдаа гарлаа', 'error');
    }
  }

  async function setArchived(next: boolean) {
    if (!klass) return;
    if (
      next &&
      !(await confirm({
        message: `"${klass.name}" бүлгийг архивлах уу? Жагсаалтаас нуугдаж, шинэ даалгавар, файл, зарлал нэмэх боломжгүй болно. Хүссэн үедээ буцааж болно.`,
        confirmLabel: 'Архивлах',
      }))
    )
      return;
    try {
      setKlass(await api.updateClass(classId, { archived: next }));
      toast(next ? 'Бүлэг архивлагдлаа' : 'Бүлэг архиваас гарлаа');
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Алдаа гарлаа', 'error');
    }
  }

  async function leaveGroup() {
    if (!klass) return;
    if (!(await confirm({ message: `"${klass.name}" бүлгээс гарах уу?`, danger: true, confirmLabel: 'Гарах' }))) return;
    try {
      await api.leaveClass(classId);
      toast('Бүлгээс гарлаа');
      router.push('/classroom');
    } catch (err) {
      toast((err as ApiError).payload?.error || 'Алдаа гарлаа', 'error');
    }
  }

  if (!klass || !assignments) return <LoadingScreen />;

  return (
    <View>
      <Link
        href="/classroom"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink"
      >
        <ArrowLeft size={15} /> Бүх бүлэг
      </Link>

      {archived && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-amber/50 bg-amber/10 px-4 py-3">
          <p className="flex items-center gap-2 text-[14px] text-ink">
            <Archive size={16} className="shrink-0" aria-hidden />
            Энэ бүлэг архивлагдсан. Шинэ даалгавар, файл, зарлал нэмэх боломжгүй.
          </p>
          {isOwner && (
            <button
              type="button"
              onClick={() => setArchived(false)}
              className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink/20 px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:border-ink"
            >
              <ArchiveRestore size={14} /> Архиваас гаргах
            </button>
          )}
        </div>
      )}

      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      <div className="mt-6">
        {activeTab === 'stream' && (
          <ClassStream
            klass={klass}
            assignments={assignments}
            isTeacher={isTeacher}
            isOwner={isOwner}
            onEdit={() => setEditOpen(true)}
            onCodeReset={(code) => setKlass({ ...klass, code })}
          />
        )}

        {activeTab === 'classwork' && (
          <ClassAssignments
            classId={classId}
            isTeacher={isTeacher}
            archived={archived}
            assignments={assignments}
            onCreated={reloadAssignments}
          />
        )}

        {activeTab === 'materials' && (
          <ClassMaterials classId={classId} isTeacher={isTeacher} archived={archived} />
        )}

        {activeTab === 'notes' && (
          <ClassNotes classId={classId} currentUser={user} />
        )}

        {activeTab === 'quiz' && <ClassQuiz classId={classId} isTeacher={isTeacher} />}

        {activeTab === 'people' && <People classId={classId} canManage={isTeacher} isOwner={isOwner} />}

        {activeTab === 'marks' && (
          <ClassMarks
            classId={classId}
            groupName={klass.name}
            archived={archived}
            assignments={assignments}
            isTeacher={isTeacher}
          />
        )}
      </div>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-5">
        {isOwner ? (
          <>
            {!archived && (
              <button
                type="button"
                onClick={() => setArchived(true)}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-line px-4 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
              >
                <Archive size={14} /> Архивлах
              </button>
            )}
            <button
              type="button"
              onClick={deleteGroup}
              className="inline-flex items-center gap-1.5 rounded-full border-2 border-coral/40 px-4 py-2 text-[13px] font-semibold text-coral transition-colors hover:bg-coral/10"
            >
              <Trash2 size={14} /> Бүлгийг устгах
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={leaveGroup}
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-line px-4 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:border-coral/40 hover:text-coral"
          >
            <LogOut size={14} /> Бүлгээс гарах
          </button>
        )}
      </div>

      {isTeacher && (
        <EditClassDialog
          open={editOpen}
          klass={klass}
          onClose={() => setEditOpen(false)}
          onSaved={setKlass}
        />
      )}
    </View>
  );
}
