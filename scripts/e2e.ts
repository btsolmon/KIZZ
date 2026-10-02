// End-to-end API test against a running server (default: `bun run start -p 3460`).
// Creates throwaway `e2e-*@example.test` users; scripts/e2e-cleanup.ts removes them.
//   E2E_BASE=http://localhost:3460 bun --env-file=.env.local run scripts/e2e.ts
const BASE = `${process.env.E2E_BASE ?? 'http://localhost:3460'}/api`;
const stamp = Date.now();
const results: { name: string; ok: boolean; info?: string }[] = [];
function check(name: string, ok: boolean, info?: unknown) {
  results.push({ name, ok, info: ok ? undefined : JSON.stringify(info)?.slice(0, 200) });
  if (process.env.E2E_VERBOSE) console.log(ok ? 'ok  ' : 'FAIL', name);
}
async function call(token: string | null, method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res = await fetch(BASE + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  // The hosted DB pooler occasionally drops a connection; retry reads once.
  if (method === 'GET' && res.status >= 500) res = await fetch(BASE + path, { method, headers });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : null;
  return { status: res.status, data, res };
}
const out: Record<string, unknown> = {};
const balanceOf = async (tok: string) => (await call(tok, 'GET', '/points/balance')).data as { balance: number; xp: number; level: number };

// Quizzes normally come from the AI (slow, needs a key), so the tests create
// them straight in the DB and exercise the rest of the flow.
import postgres from 'postgres';
import { DEFAULT_AVATAR_OPTIONS } from '../src/lib/avatar';
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const QUESTIONS = [0, 1, 2].map((i) => ({
  id: crypto.randomUUID(),
  prompt: `Question ${i + 1}?`,
  options: ['a', 'b', 'c', 'd'],
  correctIndex: i,
  explanation: '',
}));
async function seedQuiz(opts: { ownerId?: string; classId?: string; noteId: string }) {
  const [row] = await sql`insert into quizzes (owner_id, class_id, source_note_id, title, questions, generated_by)
    values (${opts.ownerId ?? null}, ${opts.classId ?? null}, ${opts.noteId}, 'Seeded quiz', ${sql.json(QUESTIONS)}, 'ai') returning id`;
  return { id: row.id as string, questions: QUESTIONS };
}

// --- auth
const emailA = `e2e-a-${stamp}@example.test`, emailB = `e2e-b-${stamp}@example.test`;
let r = await call(null, 'POST', '/auth/signup', { name: 'E2E Admin', email: emailA, password: 'secret12' });
check('signup A (no role)', r.status === 201 || r.status === 200, r);
const tokA = r.data?.token; const userA = r.data?.user;
r = await call(null, 'POST', '/auth/signup', { name: 'E2E Member', email: emailB, password: 'secret12' });
check('signup B', r.status < 300, r);
const tokB = r.data?.token; const userB = r.data?.user;
const emailC = `e2e-c-${stamp}@example.test`, emailD = `e2e-d-${stamp}@example.test`;
const rc = await call(null, 'POST', '/auth/signup', { name: 'E2E C', email: emailC, password: 'secret12' }); const tokC = rc.data?.token; const userC = rc.data?.user;
const rd = await call(null, 'POST', '/auth/signup', { name: 'E2E D', email: emailD, password: 'secret12' }); const tokD = rd.data?.token; const userD = rd.data?.user;
const extra = async (tag: string) => (await call(null, 'POST', '/auth/signup', { name: `E2E ${tag}`, email: `e2e-${tag.toLowerCase()}-${stamp}@example.test`, password: 'secret12' })).data?.token as string;
const tokE = await extra('E'), tokF = await extra('F'), tokG = await extra('G');
r = await call(null, 'POST', '/auth/signup', { name: 'dup', email: emailA, password: 'secret12' });
check('duplicate email rejected (409)', r.status === 409, r);
r = await call(null, 'POST', '/auth/login', { email: emailA, password: 'wrong-pass' });
check('wrong password rejected', r.status === 401, r);
r = await call(null, 'POST', '/auth/login', { email: emailA, password: 'secret12' });
check('login', r.status === 200 && !!r.data?.token, r);
r = await call(tokA, 'GET', '/auth/me'); check('me', r.status === 200 && r.data?.email === emailA, r);
r = await call(null, 'GET', '/auth/me'); check('me without token = 401', r.status === 401, r);

// --- personal notes
r = await call(tokA, 'POST', '/me/notes', { title: 'Personal note' });
check('create personal note', r.status === 201, r); const pn = r.data;
check('first note grants 20 XP once', (await balanceOf(tokA)).xp === 20, await balanceOf(tokA));
check('note creation response reports the first-note XP', r.data?.reward?.xp === 20, r.data?.reward);
const content = 'Мицохондри бол эсийн эрчим хүчний үүсгүүр юм. Хлоропласт нь фотосинтез явуулдаг эсийн хэсэг юм. Рибосом нь уураг нийлэгжүүлдэг эсийн бүтэц юм. Цөм нь удамшлын мэдээллийг хадгалдаг эсийн төв юм. Голжи бие нь уургийг боловсруулж савладаг эсийн бүтэц юм.';
r = await call(tokA, 'PATCH', `/notes/${pn?.id}`, { content, baseUpdatedAt: pn?.updatedAt });
check('edit personal note', r.status === 200 && r.data?.content === content, r);
r = await call(tokB, 'GET', `/notes/${pn?.id}`); check('personal note hidden from others (404)', r.status === 404, r);
r = await call(tokA, 'GET', '/me/notes'); check('list personal notes', r.status === 200 && r.data?.length === 1, r);
r = await call(tokB, 'GET', '/me/notes'); check('B has no personal notes', r.status === 200 && r.data?.length === 0, r);
r = await call(tokA, 'POST', '/me/notes', { title: '  ' }); check('empty title rejected', r.status === 400, r);

// --- attachments
const fd = new FormData(); fd.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], 'тест.png', { type: 'image/png' }));
r = await call(tokA, 'POST', `/notes/${pn?.id}/attachments`, undefined, fd);
check('upload attachment', r.status === 201, r); const att = r.data;
const fake = new FormData(); fake.append('file', new File([new Uint8Array([1, 2, 3, 4, 5])], 'fake.png', { type: 'image/png' }));
r = await call(tokA, 'POST', `/notes/${pn?.id}/attachments`, undefined, fake); check('fake png (bad signature) rejected (415)', r.status === 415, r.status);
const bad = new FormData(); bad.append('file', new File(['x'], 'a.exe', { type: 'application/x-msdownload' }));
r = await call(tokA, 'POST', `/notes/${pn?.id}/attachments`, undefined, bad); check('bad file type rejected (415)', r.status === 415, r);
const bigPng = new Uint8Array(3 * 1024 * 1024 + 8);
bigPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const big = new FormData(); big.append('file', new File([bigPng], 'big.png', { type: 'image/png' }));
r = await call(tokA, 'POST', `/notes/${pn?.id}/attachments`, undefined, big); check('too-large file rejected (413)', r.status === 413, r.status);
r = await call(tokA, 'GET', `/notes/${pn?.id}/attachments`); check('list attachments', r.data?.length === 1, r);
r = await call(tokA, 'GET', `/note-attachments/${att?.id}`); check('download attachment', r.status === 200, r.status);
r = await call(tokB, 'GET', `/note-attachments/${att?.id}`); check('attachment hidden from others', r.status === 404, r.status);
r = await call(tokA, 'DELETE', `/note-attachments/${att?.id}`); check('delete attachment', r.status === 200, r);

// --- quiz generation
const quiz = await seedQuiz({ ownerId: userA?.id, noteId: pn?.id });
r = await call(tokA, 'POST', `/notes/${pn?.id}/generate-quiz`, { count: 3 });
check('AI quiz (Gemini) works or fails cleanly', r.status === 201 || [501, 502].includes(r.status), r);
out.aiStatus = r.status; out.aiMsg = r.data?.error;
const xpBeforeSecondNote = (await balanceOf(tokA)).xp;
const empty = (await call(tokA, 'POST', '/me/notes', { title: 'short' })).data;
check('a second note grants no more XP', (await balanceOf(tokA)).xp === xpBeforeSecondNote, await balanceOf(tokA));
r = await call(tokA, 'POST', `/notes/${empty?.id}/generate-quiz`, { count: 3 }); check('quiz from empty note gives clear 400', r.status === 400, r);
r = await call(tokA, 'GET', '/me/quizzes'); check('list my quizzes', r.status === 200 && r.data?.length >= 1, r);
r = await call(tokB, 'GET', `/quizzes/${quiz?.id}`); check('personal quiz hidden from others', r.status === 404, r);

// --- group (class)
r = await call(tokA, 'POST', '/classes', { name: 'E2E Group' }); check('any user creates group', r.status === 201, r); const klass = r.data;
r = await call(tokB, 'POST', '/classes/join', { code: 'ZZZZZ' }); check('bad join code 404', r.status === 404, r);
r = await call(tokB, 'POST', '/classes/join', { code: klass?.code.toLowerCase() }); check('join by code (case-insens.)', r.status === 200, r);
r = await call(tokA, 'POST', '/classes/join', { code: klass?.code }); check('owner joining own group rejected', r.status === 400, r);
r = await call(tokB, 'GET', '/me/classes'); check('B sees joined group', r.data?.some((c: any) => c.id === klass?.id), r);
r = await call(tokA, 'GET', '/me/classes'); check('A sees own group', r.data?.some((c: any) => c.id === klass?.id), r);
r = await call(tokB, 'GET', `/classes/${klass?.id}`); check('member gets canManage=false', r.data?.canManage === false, r.data);
r = await call(tokA, 'GET', `/classes/${klass?.id}`); check('owner gets canManage=true', r.data?.canManage === true, r.data);
r = await call(tokA, 'GET', `/classes/${klass?.id}/people`); check('people list', r.status === 200, r);
r = await call(tokB, 'PATCH', `/classes/${klass?.id}`, { name: 'hack' }); check('member cannot edit group (403)', r.status === 403, r);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { name: 'E2E Group v2' }); check('owner edits group', r.status === 200, r);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { description: '  Mondays 19:00  ' }); check('owner sets group description', r.status === 200 && r.data?.description === 'Mondays 19:00', r.data);
r = await call(tokB, 'GET', `/classes/${klass?.id}`); check('member sees description', r.data?.description === 'Mondays 19:00', r.data);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { description: 'x'.repeat(501) }); check('too-long description rejected (400)', r.status === 400, r.status);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { description: '' }); check('empty description clears it', r.status === 200 && r.data?.description === null, r.data);

// group notes + quiz + assignment + submit + grade
r = await call(tokB, 'POST', `/classes/${klass?.id}/notes`, { title: 'Shared' }); check('member creates shared note', r.status === 201, r); const sn = r.data;
r = await call(tokA, 'PATCH', `/notes/${sn?.id}`, { content }); check('admin edits shared note', r.status === 200, r);
r = await call(tokB, 'PATCH', `/notes/${sn?.id}`, { content: content + ' Өөр өгүүлбэр байна энэ бол.', baseUpdatedAt: sn?.updatedAt });
check('stale edit -> 409 conflict with latest', r.status === 409 && !!r.data?.latest, r);
const gq = await seedQuiz({ classId: klass?.id, noteId: sn?.id });
const fa = new FormData(); fa.append('title', 'HW1'); fa.append('quizId', gq?.id);
r = await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, fa); check('admin creates assignment', r.status === 201, r); const asg = r.data;
const fp = new FormData(); fp.append('title', 'bad'); fp.append('quizId', quiz?.id);
r = await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, fp); check('personal quiz cannot be assigned (400)', r.status === 400, r);
const fm = new FormData(); fm.append('title', 'X');
r = await call(tokB, 'POST', `/classes/${klass?.id}/assignments`, undefined, fm); check('member cannot create assignment (403)', r.status === 403, r);
r = await call(tokB, 'GET', '/notifications'); check('member got new-assignment notification', r.data?.items?.some((n: any) => /HW1/.test(n.title)) && r.data.unread >= 1, r.data);
r = await call(tokA, 'GET', '/notifications'); check('admin got join notification', r.data?.items?.some((n: any) => /нэгдлээ/.test(n.title)), r.data);
r = await call(tokB, 'POST', '/notifications/read'); r = await call(tokB, 'GET', '/notifications'); check('mark notifications read', r.data?.unread === 0, r.data);
r = await call(tokA, 'POST', `/assignments/${asg?.id}/submit`, { answers: [] }); check('admin cannot submit (403)', r.status === 403, r);
r = await call(tokB, 'POST', `/assignments/${asg?.id}/submit`, { answers: gq?.questions.map((q: any) => q.correctIndex) });
check('member submits, score 100', r.status === 201 && r.data?.score === 100, r);
check('first quiz completion rewards XP (score/2) and coins (score/10)', r.data?.reward?.xp === 50 && r.data?.reward?.coins === 10, r.data);
r = await call(tokB, 'POST', `/assignments/${asg?.id}/submit`, { answers: [] }); check('resubmit before the deadline is allowed (score recomputed)', r.status === 200 && r.data?.score === 0, r);
r = await call(tokB, 'POST', `/assignments/${asg?.id}/submit`, { answers: gq?.questions.map((q: any) => q.correctIndex) }); check('resubmit again, back to 100 (and no second reward)', r.status === 200 && r.data?.score === 100 && !r.data?.reward, r);
r = await call(tokA, 'GET', `/assignments/${asg?.id}/submissions`); check('admin sees submissions', r.status === 200 && r.data?.length === 1, r); const sub = r.data?.[0];
r = await call(tokB, 'GET', `/assignments/${asg?.id}/submissions`); check('member cannot see all submissions', r.status === 403 || r.status === 404, r.status);
r = await call(tokA, 'PATCH', `/submissions/${sub?.id}`, { score: 90 }); check('admin grades', r.status === 200, r);
r = await call(tokB, 'GET', '/notifications'); check('member notified of the grade', r.data?.items?.some((n: any) => /90%/.test(n.title)), r.data?.items?.map((n: any) => n.title));
r = await call(tokA, 'PATCH', `/submissions/${sub?.id}`, { score: 95 }); check('admin re-grades', r.status === 200 && r.data?.score === 95, r);

// --- assignment editing, deadlines, reminders, grade matrix
r = await call(tokB, 'PATCH', `/assignments/${asg?.id}`, { title: 'hack' }); check('member cannot edit assignment (403)', r.status === 403, r);
r = await call(tokA, 'PATCH', `/assignments/${asg?.id}`, { title: '  HW1 renamed ', dueAt: '2099-01-01' }); check('admin edits assignment', r.status === 200 && r.data?.title === 'HW1 renamed' && r.data?.dueAt !== null, r);
r = await call(tokA, 'PATCH', `/assignments/${asg?.id}`, { dueAt: 'not-a-date' }); check('bad due date rejected (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/assignments/${asg?.id}`, {}); check('empty assignment edit rejected (400)', r.status === 400, r);
r = await call(tokB, 'GET', '/notifications'); check('member notified of deadline change', r.data?.items?.some((n: any) => /хугацаа өөрчлөгдлөө/.test(n.title)), r.data?.items?.map((n: any) => n.title));
r = await call(tokA, 'GET', `/classes/${klass?.id}/grades`); check('admin gets grade matrix', r.status === 200 && r.data?.students?.length === 1 && r.data?.students?.[0]?.cells?.[asg?.id]?.score === 95 && r.data?.students?.[0]?.average === 95, r.data);
r = await call(tokB, 'GET', `/classes/${klass?.id}/grades`); check('member cannot see grade matrix (403)', r.status === 403, r);

// --- the answer key stays with the admins while an assignment is open
const hasKey = (q: any) => !!q?.questions?.length && q.questions.every((x: any) => typeof x.correctIndex === 'number');
const noKey = (q: any) => q?.answersHidden === true && !!q?.questions?.length && q.questions.every((x: any) => x.correctIndex === undefined && x.explanation === undefined);
const picksFor = (q: any, pick: (x: any) => number) => ({ answers: q.questions.map((x: any) => ({ questionId: x.id, optionIndex: pick(x) })) });
r = await call(tokB, 'GET', `/classes/${klass?.id}/quizzes`); check('members get group quizzes without the answer key', noKey(r.data?.find((q: any) => q.id === gq?.id)), r.data);
r = await call(tokA, 'GET', `/classes/${klass?.id}/quizzes`); check('admins get the answer key', hasKey(r.data?.find((q: any) => q.id === gq?.id)), r.data);
r = await call(tokB, 'GET', `/quizzes/${gq?.id}`); check('a single group quiz hides it too', noKey(r.data), r.data);
r = await call(tokB, 'GET', '/me/quizzes'); check("so does the member's quiz list", noKey(r.data?.find((q: any) => q.id === gq?.id)), r.data);
r = await call(tokA, 'GET', '/me/quizzes'); check('the owner keeps the key of a personal quiz', hasKey(r.data?.find((q: any) => q.id === quiz?.id)), r.data);
r = await call(tokB, 'GET', `/assignments/${asg?.id}`); check('an open assignment hides the key but marks each answer', noKey(r.data?.quiz) && r.data?.myCorrect?.length === 3 && r.data.myCorrect.every(Boolean), r.data);
r = await call(tokB, 'POST', `/quizzes/${gq?.id}/check`, picksFor(gq, (x) => x.correctIndex));
check('practice on an assigned quiz says what was right, not the answers', r.status === 200 && r.data?.results?.length === 3 && r.data.results.every((x: any) => x.correct && x.correctIndex === undefined), r.data);
r = await call(tokA, 'POST', `/quizzes/${gq?.id}/check`, picksFor(gq, () => 0)); check('admins get the answers when checking', r.data?.results?.every((x: any) => typeof x.correctIndex === 'number'), r.data);
check('an empty check is rejected (400)', (await call(tokB, 'POST', `/quizzes/${gq?.id}/check`, { answers: [] })).status === 400);
check('non-members cannot check (404)', (await call(tokC, 'POST', `/quizzes/${gq?.id}/check`, picksFor(gq, () => 0))).status === 404);
r = await call(tokB, 'POST', '/games', { quizId: gq?.id }); check('a member cannot start a game on an assigned quiz (409)', r.status === 409, r);
r = await call(tokA, 'POST', '/games', { quizId: gq?.id }); const adminLobby = r.data; check('an admin can', r.status === 201, r);
r = await call(tokB, 'POST', '/games', { quizId: gq?.id }); check('and members join that lobby', r.status === 200 && r.data?.id === adminLobby?.id, r);
await call(tokA, 'POST', `/games/${adminLobby?.id}/end`);
const freeQuiz = await seedQuiz({ classId: klass?.id, noteId: sn?.id });
r = await call(tokB, 'POST', `/quizzes/${freeQuiz.id}/check`, picksFor(freeQuiz, () => 0)); check('practice on an unassigned quiz shows the answers', r.data?.results?.every((x: any) => typeof x.correctIndex === 'number'), r.data);
const fpq = new FormData(); fpq.append('title', 'Past quiz'); fpq.append('quizId', freeQuiz.id); fpq.append('dueAt', '2020-01-01');
const pastQuiz = (await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, fpq)).data;
r = await call(tokB, 'GET', `/assignments/${pastQuiz?.id}`); check('past due but not handed in: still no key (a late submission is possible)', noKey(r.data?.quiz), r.data);
r = await call(tokB, 'POST', `/quizzes/${freeQuiz.id}/check`, picksFor(freeQuiz, () => 0)); check('practice keeps the answers back then too', r.data?.results?.every((x: any) => x.correctIndex === undefined), r.data);
r = await call(tokB, 'POST', `/assignments/${pastQuiz?.id}/submit`, { answers: [0, 0, 0] }); check('late quiz submission', r.status === 201, r);
r = await call(tokB, 'GET', `/assignments/${pastQuiz?.id}`); check('handed in after the deadline: the key is shown', hasKey(r.data?.quiz) && !r.data?.quiz?.answersHidden && r.data?.myCorrect?.join() === 'true,false,false', r.data);
await call(tokA, 'DELETE', `/assignments/${pastQuiz?.id}`);

const past = new FormData(); past.append('title', 'Late one'); past.append('dueAt', '2020-01-01');
r = await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, past); check('create assignment already past due', r.status === 201, r); const pastAsg = r.data;
r = await call(tokB, 'POST', `/assignments/${pastAsg?.id}/submit`); check('late first submission still accepted', r.status === 201, r);
r = await call(tokB, 'POST', `/assignments/${pastAsg?.id}/submit`); check('resubmit after the deadline -> 409', r.status === 409, r);
r = await call(tokA, 'GET', `/assignments/${pastAsg?.id}/submissions`); check('late flag on submission', r.data?.[0]?.late === true, r.data);
r = await call(tokA, 'GET', '/notifications'); check('admin notified of quiz-less submission', r.data?.items?.some((n: any) => /Late one/.test(n.title)), r.data?.items?.map((n: any) => n.title));
const soon = new FormData(); soon.append('title', 'Due soon'); soon.append('dueAt', new Date(Date.now() + 6 * 3600_000).toISOString());
r = await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, soon); check('create assignment due in 6h', r.status === 201, r);
r = await call(tokB, 'GET', '/notifications'); const reminders = r.data?.items?.filter((n: any) => /удахгүй дуусна/.test(n.title) && /Due soon/.test(n.title)) ?? [];
check('due-soon reminder created', reminders.length === 1, r.data?.items?.map((n: any) => n.title));
r = await call(tokB, 'GET', '/notifications'); check('reminder is not duplicated', (r.data?.items?.filter((n: any) => /Due soon/.test(n.title) && /удахгүй/.test(n.title)).length ?? 0) === 1, r.data?.items?.length);

r = await call(tokB, 'GET', `/me/quizzes`); check('member sees group quiz', r.data?.some((q: any) => q.id === gq?.id), r);
// material
const fmat = new FormData(); fmat.append('file', new File(['hello'], 'a.txt', { type: 'text/plain;charset=utf-8' }));
r = await call(tokA, 'POST', `/classes/${klass?.id}/materials`, undefined, fmat); check('admin uploads material', r.status === 201, r); const mat = r.data;
r = await call(tokB, 'GET', `/materials/${mat?.id}`); check('member downloads material', r.status === 200, r.status);
r = await call(tokB, 'DELETE', `/materials/${mat?.id}`); check('member cannot delete material (403)', r.status === 403, r.status);

// --- assignment instructions, due times, members' files
const txt = (name: string, body = 'work') => new File([body], name, { type: 'text/plain' });
const fi = new FormData(); fi.append('title', 'Essay'); fi.append('description', '  Write one page.  '); fi.append('dueAt', '2099-01-01T18:30:00+08:00'); fi.append('file', txt('brief.txt'));
r = await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, fi); const essay = r.data;
check('assignment with instructions, due time and file', r.status === 201 && essay?.description === 'Write one page.' && essay?.dueAt === '2099-01-01T10:30:00.000Z' && !!essay?.materialId, r.data);
const flong = new FormData(); flong.append('title', 'Long'); flong.append('description', 'x'.repeat(2001));
r = await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, flong); check('too-long instructions rejected (400)', r.status === 400, r.status);
r = await call(tokB, 'GET', `/assignments/${essay?.id}`); check('member sees instructions', r.data?.description === 'Write one page.', r.data);
r = await call(tokA, 'PATCH', `/assignments/${essay?.id}`, { description: 'Two pages.' }); check('admin edits instructions', r.status === 200 && r.data?.description === 'Two pages.', r.data);
r = await call(tokA, 'PATCH', `/assignments/${essay?.id}`, { description: '' }); check('empty instructions clear them', r.status === 200 && r.data?.description === null, r.data);
r = await call(tokC, 'POST', '/classes/join', { code: klass?.code }); check('C joins to test file privacy', r.status === 200, r);
const fw1 = new FormData(); fw1.append('answers', '[]'); fw1.append('file', txt('mine.txt', 'v1'));
r = await call(tokB, 'POST', `/assignments/${essay?.id}/submit`, undefined, fw1); check('member submits with a file', r.status === 201, r);
r = await call(tokA, 'GET', `/assignments/${essay?.id}/submissions`); const work1 = r.data?.[0]?.materialId;
check('admin sees the submitted file', !!work1, r.data);
check('admin downloads the submitted file', (await call(tokA, 'GET', `/materials/${work1}`)).status === 200);
check('owner downloads their own file', (await call(tokB, 'GET', `/materials/${work1}`)).status === 200);
check('another member cannot download it (404)', (await call(tokC, 'GET', `/materials/${work1}`)).status === 404);
r = await call(tokB, 'GET', `/classes/${klass?.id}/materials`); check('submitted work stays out of the materials list', !r.data?.some((m: any) => m.id === work1) && r.data?.some((m: any) => m.id === essay?.materialId), r.data);
check('admin cannot delete a submitted file (403)', (await call(tokA, 'DELETE', `/materials/${work1}`)).status === 403);
const fw2 = new FormData(); fw2.append('answers', '[]'); fw2.append('file', txt('mine2.txt', 'v2'));
r = await call(tokB, 'POST', `/assignments/${essay?.id}/submit`, undefined, fw2); check('resubmit with a new file', r.status === 200, r);
r = await call(tokA, 'GET', `/assignments/${essay?.id}/submissions`); const work2 = r.data?.[0]?.materialId;
check('new file replaces the old one', !!work2 && work2 !== work1 && (await call(tokB, 'GET', `/materials/${work1}`)).status === 404, { work1, work2 });
r = await call(tokB, 'POST', `/assignments/${essay?.id}/submit`); check('resubmit without a file', r.status === 200, r);
r = await call(tokA, 'GET', `/assignments/${essay?.id}/submissions`); check('and the earlier file is kept', r.data?.[0]?.materialId === work2, r.data);
check('members cannot send reminders (403)', (await call(tokB, 'POST', `/assignments/${essay?.id}/remind`)).status === 403);
r = await call(tokA, 'POST', `/assignments/${essay?.id}/remind`); check('admin reminds whoever has not handed in', r.status === 200 && r.data?.reminded === 1 && r.data?.missing === 1, r.data);
r = await call(tokA, 'POST', `/assignments/${essay?.id}/remind`); check('a second reminder the same day sends nothing', r.data?.reminded === 0 && r.data?.missing === 1, r.data);
r = await call(tokC, 'GET', '/notifications'); check('the member got one reminder', r.data?.items?.filter((n: any) => /даалгавраа илгээгээрэй/.test(n.title)).length === 1, r.data?.items?.map((n: any) => n.title));
const fq = new FormData(); fq.append('title', 'Form quiz'); fq.append('quizId', gq?.id);
const formQuiz = (await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, fq)).data;
const fqa = new FormData(); fqa.append('answers', JSON.stringify(gq?.questions.map((q: any) => q.correctIndex)));
r = await call(tokB, 'POST', `/assignments/${formQuiz?.id}/submit`, undefined, fqa); check('quiz answers as form data are scored', r.status === 201 && r.data?.score === 100, r.data);
r = await call(tokA, 'DELETE', `/materials/${essay?.materialId}`); check('admin deletes a file attached to an assignment', r.status === 200, r);
r = await call(tokB, 'GET', `/assignments/${essay?.id}`); check('the assignment just loses the attachment', r.status === 200 && r.data?.materialId === null, r.data);
r = await call(tokA, 'DELETE', `/assignments/${essay?.id}`); check('deleting the assignment removes members\' files', r.status === 200 && (await call(tokA, 'GET', `/materials/${work2}`)).status === 404, r);
await call(tokA, 'DELETE', `/assignments/${formQuiz?.id}`);

// --- join code reset
const oldCode = klass?.code;
r = await call(tokB, 'POST', `/classes/${klass?.id}/code`); check('member cannot reset the code (403)', r.status === 403, r);
r = await call(tokA, 'POST', `/classes/${klass?.id}/code`); check('owner resets the code', r.status === 200 && !!r.data?.code && r.data.code !== oldCode, r.data);
klass.code = r.data?.code;
r = await call(tokA, 'GET', `/classes/${klass?.id}`); check('group shows the new code', r.data?.code === klass.code, r.data);
r = await call(tokD, 'POST', '/classes/join', { code: oldCode }); check('old code stops working (404)', r.status === 404, r);
check('current members stay', (await call(tokC, 'GET', `/classes/${klass?.id}`)).status === 200);

// --- archiving
r = await call(tokB, 'PATCH', `/classes/${klass?.id}`, { archived: true }); check('member cannot archive (403)', r.status === 403, r);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { archived: 'yes' }); check('archived must be a boolean (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { archived: true }); check('owner archives the group', r.status === 200 && !!r.data?.archivedAt, r.data);
r = await call(tokB, 'GET', '/me/classes'); check('members see it as archived', r.data?.find((c: any) => c.id === klass?.id)?.archivedAt, r.data);
const farch = new FormData(); farch.append('title', 'Nope');
check('archived: no new assignments (409)', (await call(tokA, 'POST', `/classes/${klass?.id}/assignments`, undefined, farch)).status === 409);
const fmat2 = new FormData(); fmat2.append('file', txt('b.txt'));
check('archived: no new files (409)', (await call(tokA, 'POST', `/classes/${klass?.id}/materials`, undefined, fmat2)).status === 409);
check('archived: no new announcements (409)', (await call(tokA, 'POST', `/classes/${klass?.id}/posts`, { body: 'hi' })).status === 409);
check('archived: no submissions (409)', (await call(tokB, 'POST', `/assignments/${asg?.id}/submit`, { answers: [] })).status === 409);
check('archived: nobody new can join (409)', (await call(tokD, 'POST', '/classes/join', { code: klass?.code })).status === 409);
check('archived: still readable', (await call(tokB, 'GET', `/classes/${klass?.id}/assignments`)).status === 200);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}`, { archived: false }); check('owner restores the group', r.status === 200 && r.data?.archivedAt === null, r.data);
check('C leaves again', (await call(tokC, 'DELETE', `/classes/${klass?.id}/membership`)).status === 200);

// --- live game + economy
async function runGame(hostTok: string, quizId: string, players: { tok: string; picks: (number | null)[] }[]) {
  const g = (await call(hostTok, 'POST', '/games', { quizId })).data;
  for (const p of players) await call(p.tok, 'POST', `/games/${g.id}/join`);
  await call(hostTok, 'POST', `/games/${g.id}/start`);
  for (let q = 0; q < gq.questions.length; q++) {
    for (const p of players) if (p.picks[q] !== null) await call(p.tok, 'POST', `/games/${g.id}/answer`, { optionIndex: p.picks[q] });
    await call(hostTok, 'POST', `/games/${g.id}/reveal`);
    await call(hostTok, 'POST', `/games/${g.id}/next`);
  }
  return g;
}
const rightAnswers = gq.questions.map((q: any) => q.correctIndex);
const mostlyWrong = gq.questions.map((q: any, i: number) => (i === 0 ? q.correctIndex : (q.correctIndex + 1) % 4));
const threePlayers = () => [
  { tok: tokB, picks: rightAnswers },
  { tok: tokC, picks: mostlyWrong },
  { tok: tokD, picks: gq.questions.map(() => null) },
];

r = await call(tokA, 'POST', '/games', { quizId: gq?.id }); check('host creates game', r.status === 201, r); const game = r.data;
r = await call(tokB, 'GET', `/games/code/${game?.code}`); check('lookup by code', r.status === 200, r);
r = await call(tokB, 'POST', `/games/${game?.id}/join`); check('join game', r.status < 300, r);
r = await call(tokB, 'POST', `/games/${game?.id}/start`); check('non-host cannot start (403)', r.status === 403, r);
r = await call(tokA, 'POST', `/games/${game?.id}/finish`, { results: [] }); check('cannot finish a game that has not started (400)', r.status === 400, r);
r = await call(tokA, 'POST', `/games/${game?.id}/start`); check('host starts', r.status < 300, r);
r = await call(tokB, 'POST', `/games/${game?.id}/answer`, { optionIndex: gq?.questions[0].correctIndex }); check('answer', r.status < 300, r);
r = await call(tokB, 'POST', `/games/${game?.id}/answer`, { optionIndex: 0 }); check('second answer rejected', r.status >= 400, r);

// forged results must not pay anyone: the server ranks the real players itself
const aBefore = await balanceOf(tokA); const bBefore = await balanceOf(tokB);
r = await call(tokA, 'POST', `/games/${game?.id}/finish`, { results: [{ userId: userA?.id, rank: 1, score: 9999 }, { userId: userC?.id, rank: 2, score: 1 }, { userId: userD?.id, rank: 3, score: 1 }] });
check('early finish ignores forged results', r.status === 200 && r.data?.results?.length === 1 && r.data?.results?.[0]?.userId === userB?.id, r.data);
check('forged finish paid nobody (host balance unchanged)', (await balanceOf(tokA)).balance === aBefore.balance && (await balanceOf(tokA)).xp === aBefore.xp);
check('a solo game (below the player minimum) pays nothing', (await balanceOf(tokB)).balance === bBefore.balance && (await balanceOf(tokB)).xp === bBefore.xp, await balanceOf(tokB));
r = await call(tokA, 'POST', `/games/${game?.id}/finish`, {}); check('finishing twice is rejected (400)', r.status === 400, r);
r = await call(tokB, 'POST', `/games/${game?.id}/join`); check('cannot join a finished game (409)', r.status === 409, r);

const b1 = await balanceOf(tokB), c1 = await balanceOf(tokC), d1 = await balanceOf(tokD);
const game3 = await runGame(tokA, gq.id, threePlayers());
r = await call(tokB, 'GET', `/games/${game3.id}/state`); check('3-player game finishes', r.data?.status === 'finished', r.data?.status);
const b2 = await balanceOf(tokB), c2 = await balanceOf(tokC), d2 = await balanceOf(tokD);
check('1st place earns 500 coins + 100 XP', b2.balance - b1.balance === 500 && b2.xp - b1.xp === 100, { b1, b2 });
check('2nd place earns 300 coins + 60 XP', c2.balance - c1.balance === 300 && c2.xp - c1.xp === 60, { c1, c2 });
check('a player who never scored earns nothing', d2.balance === d1.balance && d2.xp === d1.xp, { d1, d2 });
{
  const rb = (await call(tokB, 'GET', `/games/${game3.id}/state`)).data?.myReward;
  const rc = (await call(tokC, 'GET', `/games/${game3.id}/state`)).data?.myReward;
  const rd = (await call(tokD, 'GET', `/games/${game3.id}/state`)).data?.myReward;
  const rh = (await call(tokA, 'GET', `/games/${game3.id}/state`)).data?.myReward;
  check('finished game state tells each player what they earned', rb?.coins === 500 && rb?.xp === 100 && rb?.rank === 1 && rc?.coins === 300 && rc?.xp === 60 && rd?.coins === 0 && rd?.xp === 0, { rb, rc, rd });
  check('the host has no reward entry', rh === null, rh);
  const spare = await seedQuiz({ ownerId: userA?.id, noteId: pn?.id });
  const running = (await call(tokA, 'POST', '/games', { quizId: spare.id })).data;
  check('reward is not exposed while a game is not finished', (await call(tokA, 'GET', `/games/${running.id}/state`)).data?.myReward === null);
}

// --- level-up + notification management
r = await call(tokB, 'GET', '/notifications');
check('levelling up creates a notification', r.data?.items?.some((n: any) => /түвшин боллоо/.test(n.title)), r.data?.items?.map((n: any) => n.title));
{
  const items = r.data?.items ?? [];
  const unread = items.find((n: any) => !n.read);
  if (unread) {
    check('someone else cannot mark my notification (404)', (await call(tokC, 'PATCH', `/notifications/${unread.id}`)).status === 404);
    check('someone else cannot delete my notification (404)', (await call(tokC, 'DELETE', `/notifications/${unread.id}`)).status === 404);
    const before = r.data.unread;
    check('mark one notification read', (await call(tokB, 'PATCH', `/notifications/${unread.id}`)).status === 200);
    r = await call(tokB, 'GET', '/notifications'); check('unread count drops by one', r.data?.unread === before - 1, { before, after: r.data?.unread });
    check('delete one notification', (await call(tokB, 'DELETE', `/notifications/${unread.id}`)).status === 200);
    r = await call(tokB, 'GET', '/notifications'); check('deleted notification is gone', !r.data?.items?.some((n: any) => n.id === unread.id));
  }
  check('bad notification id -> 404', (await call(tokB, 'DELETE', '/notifications/nope')).status === 404);
  check('clear all notifications', (await call(tokB, 'DELETE', '/notifications')).status === 200);
  r = await call(tokB, 'GET', '/notifications'); check('nothing left after clearing', r.data?.items?.length === 0 && r.data?.unread === 0, r.data);
}

await runGame(tokA, gq.id, threePlayers());
const b3 = await balanceOf(tokB);
check('second win the same day still pays (up to the cap)', b3.balance - b2.balance === 500, { b2, b3 });
await runGame(tokA, gq.id, threePlayers());
const b4 = await balanceOf(tokB);
check('daily coin cap: no more coins after 1000 from games', b4.balance === b3.balance, { b3, b4 });
check('XP is not capped', b4.xp - b3.xp === 100, { b3, b4 });
r = await call(tokB, 'GET', '/points/history'); check('history lists the awards', r.status === 200 && JSON.stringify(r.data).includes('quiz_placement'), r.status);

// --- the host playing along with their own game
{
  const hostQuiz = await seedQuiz({ ownerId: userA?.id, noteId: pn?.id });
  const rightA = gq.questions.map((q: any) => q.correctIndex);
  const wrongA = gq.questions.map((q: any) => (q.correctIndex + 1) % 4);
  const halfRight = gq.questions.map((q: any, i: number) => (i === 0 ? q.correctIndex : (q.correctIndex + 1) % 4));
  const none = gq.questions.map(() => null);

  const hg = (await call(tokA, 'POST', '/games', { quizId: hostQuiz.id })).data;
  r = await call(tokA, 'GET', `/games/${hg.id}/state`); check('state tells whether the caller plays', r.data.isHost === true && r.data.isPlayer === false && r.data.hostUserId === userA?.id, r.data);
  r = await call(tokA, 'POST', `/games/${hg.id}/join`); check('the host can play along from the lobby', r.status === 200 && r.data.isPlayer === true && r.data.players.some((p: any) => p.userId === userA?.id), r);
  r = await call(tokA, 'DELETE', `/games/${hg.id}/join`); check('and change their mind', r.status === 200 && r.data.isPlayer === false && r.data.players.length === 0, r.data);
  r = await call(tokA, 'POST', `/games/${hg.id}/join`); check('join again', r.data.isPlayer === true, r.data);
  r = await call(tokE, 'POST', `/games/${hg.id}/join`); check('others join as usual', r.status === 200, r);
  await call(tokF, 'POST', `/games/${hg.id}/join`);
  await call(tokA, 'POST', `/games/${hg.id}/start`);
  r = await call(tokA, 'DELETE', `/games/${hg.id}/join`); check('nobody can leave once it started (409)', r.status === 409, r);
  r = await call(tokG, 'POST', `/games/${hg.id}/join`); check('late players can still join a running game', r.status === 200, r);
  r = await call(tokA, 'POST', `/games/${hg.id}/answer`, { optionIndex: wrongA[0] }); check('the host answers like a player', r.status < 300, r);
  for (let q = 0; q < gq.questions.length; q++) {
    if (q > 0) await call(tokA, 'POST', `/games/${hg.id}/answer`, { optionIndex: wrongA[q] });
    await call(tokE, 'POST', `/games/${hg.id}/answer`, { optionIndex: rightA[q] });
    await call(tokF, 'POST', `/games/${hg.id}/answer`, { optionIndex: halfRight[q] });
    if (none[q] !== null) await call(tokG, 'POST', `/games/${hg.id}/answer`, { optionIndex: none[q] });
    await call(tokA, 'POST', `/games/${hg.id}/reveal`);
    await call(tokA, 'POST', `/games/${hg.id}/next`);
  }
  const eAfter = await balanceOf(tokE), fAfter = await balanceOf(tokF), gAfter = await balanceOf(tokG), aAfter = await balanceOf(tokA);
  check('with 3 other players it pays: 1st place', eAfter.balance >= 500 && eAfter.xp >= 100, eAfter);
  check('with 3 other players it pays: 2nd place', fAfter.balance >= 300, fAfter);
  check('the player who never scored earns nothing', gAfter.balance === 0 && gAfter.xp === 0, gAfter);
  r = await call(tokA, 'GET', `/games/${hg.id}/state`);
  check('the host played but earned no coins or XP', r.data.myReward?.coins === 0 && r.data.myReward?.xp === 0 && r.data.players.some((p: any) => p.userId === userA?.id), r.data.myReward);
  const aXpBefore = aAfter.xp;

  // the host must not count towards the 3-player minimum
  const hg2 = (await call(tokA, 'POST', '/games', { quizId: hostQuiz.id })).data;
  await call(tokA, 'POST', `/games/${hg2.id}/join`);
  await call(tokE, 'POST', `/games/${hg2.id}/join`);
  await call(tokF, 'POST', `/games/${hg2.id}/join`);
  await call(tokA, 'POST', `/games/${hg2.id}/start`);
  r = await call(tokA, 'POST', `/games/${hg2.id}/join`); check('the host cannot join after it started (409)', r.status === 409, r);
  const e1 = await balanceOf(tokE), f1 = await balanceOf(tokF);
  for (let q = 0; q < gq.questions.length; q++) {
    await call(tokE, 'POST', `/games/${hg2.id}/answer`, { optionIndex: rightA[q] });
    await call(tokF, 'POST', `/games/${hg2.id}/answer`, { optionIndex: rightA[q] });
    await call(tokA, 'POST', `/games/${hg2.id}/answer`, { optionIndex: rightA[q] });
    await call(tokA, 'POST', `/games/${hg2.id}/reveal`);
    await call(tokA, 'POST', `/games/${hg2.id}/next`);
  }
  const e2 = await balanceOf(tokE), f2 = await balanceOf(tokF), a2 = await balanceOf(tokA);
  check('host + 2 others is not enough players: nobody is paid', e2.balance === e1.balance && f2.balance === f1.balance && e2.xp === e1.xp, { e1, e2, f1, f2 });
  check('the host still earns nothing', a2.balance === aAfter.balance && a2.xp === aXpBefore, { aAfter, a2 });
}

// --- points / shop / streak
r = await call(tokB, 'GET', '/points/balance'); check('balance', r.status === 200, r); out.bal = r.data;
r = await call(tokB, 'GET', '/points/history'); check('history', r.status === 200, r);
r = await call(tokB, 'POST', '/streak/claim'); check('streak claim', r.status < 300, r); out.streak = r.data;
r = await call(tokB, 'POST', '/streak/claim'); check('second claim same day rejected', r.status >= 400, r);
r = await call(tokB, 'GET', '/shop/items'); check('shop items', r.status === 200 && r.data?.items?.length > 0, r); const items = r.data?.items;
out.shopItems = items?.length;
if (items?.length) { r = await call(tokB, 'POST', '/shop/purchase', { itemId: items[0].id }); out.purchase = { status: r.status, err: r.data?.error }; check('purchase clean response (ok or clear error)', r.status < 300 || (r.status === 400 && !!r.data?.error), r); }
{
  const me = await balanceOf(tokB);
  const tier5 = items?.find((it: any) => it.minLevel >= 5);
  check('shop items carry a minimum level', items?.some((it: any) => it.minLevel > 1) === true, items?.map((it: any) => it.minLevel));
  if (tier5 && me.level < tier5.minLevel) {
    r = await call(tokB, 'POST', '/shop/purchase', { itemId: tier5.id });
    check('a level-locked avatar cannot be bought yet (403)', r.status === 403, r);
  }
}
r = await call(tokB, 'GET', '/inventory'); check('inventory', r.status === 200, r);
// --- shop avatars: render, equip, clear
for (const it of items ?? []) {
  const svg = await fetch(`${BASE}/avatars/preset/${it.id}?seed=${userB?.id}`);
  check(`avatar preset renders locally: ${it.name}`, svg.status === 200 && (svg.headers.get('content-type') ?? '').includes('svg') && (await svg.text()).startsWith('<svg'), svg.status);
}
check('avatar preset 404 for unknown id', (await fetch(`${BASE}/avatars/preset/00000000-0000-4000-8000-000000000000`)).status === 404);
const notOwned = items?.slice(1).find((i: any) => !i.owned);
if (notOwned) { r = await call(tokB, 'PUT', '/me/avatar/equip', { itemId: notOwned.id }); check('cannot wear an avatar you do not own (403)', r.status === 403, r); }
const ownedItem = items?.[0];
r = await call(tokB, 'PUT', '/me/avatar/equip', { itemId: ownedItem?.id }); check('wear a bought avatar', r.status === 200, r);
r = await call(tokB, 'GET', '/auth/me'); check('me shows worn avatar', r.data?.equippedItemId === ownedItem?.id, r.data);
r = await call(tokB, 'PUT', '/me/avatar/equip', { itemId: 'nope' }); check('equip rejects bad id (400)', r.status === 400, r);
r = await call(tokB, 'PATCH', '/me/avatar', DEFAULT_AVATAR_OPTIONS); check('customizing avatar', r.status === 200, r);
r = await call(tokB, 'GET', '/auth/me'); check('customizing clears the worn shop avatar', r.data?.equippedItemId === null, r.data);
r = await call(tokB, 'PUT', '/me/avatar/equip', { itemId: ownedItem?.id }); check('wear again', r.status === 200, r);
r = await call(tokB, 'PUT', '/me/avatar/equip', { itemId: null }); check('go back to own avatar', r.status === 200 && r.data?.equippedItemId === null, r);

r = await call(tokB, 'PATCH', '/me/avatar', { style: 'x' }); out.avatarStatus = r.status;


// --- co-admin
r = await call(tokA, 'PATCH', `/classes/${klass?.id}/members/${userB?.id}`, { admin: true }); check('owner makes member co-admin', r.status === 200, r);
r = await call(tokB, 'GET', `/classes/${klass?.id}`); check('co-admin gets canManage', r.data?.canManage === true, r.data);
r = await call(tokA, 'GET', `/classes/${klass?.id}/people`); check('people lists co-admin', r.data?.teachers?.length === 2 && r.data?.students?.length === 0, r.data);
r = await call(tokB, 'PATCH', `/classes/${klass?.id}/members/${userA?.id}`, { admin: false }); check('co-admin cannot change owner (403)', r.status === 403, r);
r = await call(tokB, 'DELETE', `/classes/${klass?.id}`); check('co-admin cannot delete group (403)', r.status === 403, r);
r = await call(tokA, 'PATCH', `/classes/${klass?.id}/members/${userB?.id}`, { admin: false }); check('owner revokes co-admin', r.status === 200, r);
r = await call(tokB, 'GET', `/classes/${klass?.id}`); check('revoked member loses canManage but stays member', r.status === 200 && r.data?.canManage === false, r.data);

// --- profile & account
r = await call(tokB, 'PATCH', '/me/profile', { name: '  Renamed  ' }); check('rename profile', r.status === 200 && r.data?.name === 'Renamed', r);
r = await call(tokB, 'PATCH', '/me/profile', { name: '' }); check('empty name rejected', r.status === 400, r);
r = await call(tokB, 'POST', '/me/password', { currentPassword: 'wrong', newPassword: 'newsecret1' }); check('password change needs current password', r.status === 400, r);
r = await call(tokB, 'POST', '/me/password', { currentPassword: 'secret12', newPassword: 'newsecret1' }); check('change password', r.status === 200, r);
r = await call(null, 'POST', '/auth/login', { email: emailB, password: 'newsecret1' }); check('login with new password', r.status === 200, r);

// --- quiz editing
const editQs = (qs: any[]) => qs.map((q) => ({ ...q }));
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { title: '  Edited title ', questions: editQs(quiz.questions).map((q, i) => (i === 0 ? { ...q, prompt: 'New prompt?', correctIndex: 3 } : q)) });
check('owner edits personal quiz', r.status === 200 && r.data?.title === 'Edited title' && r.data?.questions?.[0]?.prompt === 'New prompt?' && r.data?.questions?.[0]?.correctIndex === 3, r);
r = await call(tokB, 'PATCH', `/quizzes/${quiz.id}`, { title: 'hack' }); check('other user cannot edit personal quiz (404)', r.status === 404, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { questions: [{ ...quiz.questions[0], options: ['a', 'b', 'c'] }] }); check('quiz edit needs exactly 4 options (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { questions: [{ ...quiz.questions[0], options: ['a', 'A', 'c', 'd'] }] }); check('duplicate options rejected (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { questions: [{ ...quiz.questions[0], correctIndex: 9 }] }); check('bad correct index rejected (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { questions: [] }); check('empty question list rejected (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, {}); check('empty edit body rejected (400)', r.status === 400, r);
r = await call(tokB, 'PATCH', `/quizzes/${gq.id}`, { title: 'hack' }); check('member cannot edit group quiz (403)', r.status === 403, r);
r = await call(tokA, 'PATCH', `/quizzes/${gq.id}`, { questions: editQs(gq.questions).map((q, i) => (i === 1 ? { ...q, prompt: 'Reworded?' } : q)) });
check('admin rewords group quiz that has submissions (same structure)', r.status === 200 && r.data?.questions?.[1]?.prompt === 'Reworded?', r);
r = await call(tokA, 'PATCH', `/quizzes/${gq.id}`, { questions: editQs(gq.questions).slice(0, 2) }); check('cannot remove a question once submitted (409)', r.status === 409, r);
r = await call(tokA, 'PATCH', `/quizzes/${gq.id}`, { questions: [...editQs(gq.questions), { prompt: 'Extra?', options: ['w', 'x', 'y', 'z'], correctIndex: 0 }] }); check('cannot add a question once submitted (409)', r.status === 409, r);
r = await call(tokA, 'POST', '/games', { quizId: quiz.id }); check('host a game for personal quiz', r.status === 201, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { title: 'while live' }); check('cannot edit questions during a live game (409) — title alone is fine', r.status === 200, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { questions: editQs(quiz.questions) }); check('question edit blocked while game is live (409)', r.status === 409, r);

// --- leaderboard
r = await call(tokB, 'GET', '/leaderboard'); const lbB = r.data;
check('global leaderboard is ranked by XP', r.status === 200 && lbB.rows.length > 0 && lbB.rows.every((x: any, i: number) => i === 0 || lbB.rows[i - 1].xp >= x.xp), r.status);
check('leaderboard reports my own standing', lbB.me.xp === (await balanceOf(tokB)).xp && lbB.me.rank >= 1, lbB.me);
r = await call(tokB, 'GET', `/leaderboard?scope=class&classId=${klass?.id}`);
check('group leaderboard lists the members', r.status === 200 && r.data.rows.some((x: any) => x.id === userB?.id) && r.data.rows.some((x: any) => x.id === userA?.id), r.data);
check('group leaderboard is members-only (404)', (await call(tokC, 'GET', `/leaderboard?scope=class&classId=${klass?.id}`)).status === 404);
check('leaderboard visibility must be a boolean (400)', (await call(tokB, 'PATCH', '/me/profile', { showOnLeaderboard: 'yes' })).status === 400);
r = await call(tokB, 'PATCH', '/me/profile', { showOnLeaderboard: false }); check('opt out of the global leaderboard', r.status === 200 && r.data?.showOnLeaderboard === false, r.data);
r = await call(tokC, 'GET', '/leaderboard'); check('opted-out user is hidden from the global list', !r.data.rows.some((x: any) => x.id === userB?.id), r.data.rows.map((x: any) => x.name));
r = await call(tokB, 'GET', '/leaderboard'); check('opted-out user gets no global rank', r.data.me.rank === null, r.data.me);
r = await call(tokA, 'GET', `/leaderboard?scope=class&classId=${klass?.id}`); check('opt-out does not hide them inside their group', r.data.rows.some((x: any) => x.id === userB?.id), r.data.rows);
check('opt back in', (await call(tokB, 'PATCH', '/me/profile', { showOnLeaderboard: true })).data?.showOnLeaderboard === true);

// --- badges
r = await call(tokB, 'GET', '/me/badges');
const earnedB = new Set((r.data?.badges ?? []).filter((b: any) => b.earned).map((b: any) => b.key));
check('badge catalogue is returned', r.status === 200 && r.data.badges.length >= 10, r.data?.badges?.length);
check('badges earned by playing: first note, group, perfect score, first win', ['first_note', 'team_player', 'perfect_score', 'first_win'].every((k) => earnedB.has(k)), [...earnedB]);
check('locked badges stay locked', !earnedB.has('streak_30') && !earnedB.has('level_10'), [...earnedB]);
r = await call(tokA, 'GET', '/me/badges'); check('creating a group and a note earn badges', r.data.badges.find((b: any) => b.key === 'team_player')?.earned && r.data.badges.find((b: any) => b.key === 'first_note')?.earned, r.data.badges.filter((b: any) => b.earned).map((b: any) => b.key));
r = await call(tokA, 'GET', '/notifications'); check('earning a badge notifies', r.data.items.some((n: any) => /Шинэ тэмдэг/.test(n.title)), r.data.items.map((n: any) => n.title));

// --- public quiz library
r = await call(tokA, 'PATCH', `/quizzes/${gq.id}`, { isPublic: true }); check('a group quiz cannot be published (400)', r.status === 400, r);
r = await call(tokB, 'PATCH', `/quizzes/${quiz.id}`, { isPublic: true }); check('only the owner can publish (404)', r.status === 404, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { isPublic: 'yes' }); check('publish flag must be a boolean (400)', r.status === 400, r);
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { isPublic: true }); check('owner publishes a personal quiz', r.status === 200 && r.data?.isPublic === true, r.data);
r = await call(tokB, 'GET', '/library'); const libItem = r.data?.items?.find((i: any) => i.id === quiz.id);
check('published quiz shows in the library', r.status === 200 && !!libItem && libItem.authorName === 'E2E Admin' && libItem.questionCount === 3 && libItem.sample.length === 2 && libItem.mine === false && libItem.copied === false, libItem);
check('unpublished quizzes are not listed', !r.data.items.some((i: any) => i.id === gq.id));
r = await call(tokA, 'GET', '/library'); check('the author sees it flagged as theirs', r.data.items.find((i: any) => i.id === quiz.id)?.mine === true, r.data);
r = await call(tokB, 'GET', '/library?q=while'); check('library search by title', r.data.items.some((i: any) => i.id === quiz.id), r.data);
r = await call(tokB, 'GET', '/library?q=zzzznothing'); check('library search with no match is empty', r.data.items.length === 0, r.data);
r = await call(tokB, 'GET', '/library?q=%25'); check('% in a search is a literal, not a wildcard', r.data.items.length === 0, r.data.items.length);
r = await call(tokA, 'POST', `/library/${quiz.id}/copy`); check('cannot copy your own quiz (400)', r.status === 400, r);
r = await call(tokB, 'POST', `/library/${gq.id}/copy`); check('cannot copy a non-public quiz (404)', r.status === 404, r);
r = await call(tokB, 'POST', `/library/${quiz.id}/copy`); const copy = r.data;
check('copy a public quiz', r.status === 201 && copy?.ownerId === userB?.id && copy?.isPublic === false && copy?.questions?.length === 3 && copy?.questions?.[0]?.id !== quiz.questions[0].id, r);
r = await call(tokB, 'POST', `/library/${quiz.id}/copy`); check('copying twice is refused (409)', r.status === 409, r);
r = await call(tokB, 'GET', `/quizzes/${copy?.id}`); check('the copy is a normal personal quiz for the copier', r.status === 200, r.status);
r = await call(tokC, 'GET', `/quizzes/${copy?.id}`); check('the copy is private to the copier (404)', r.status === 404, r.status);
r = await call(tokC, 'GET', '/library?sort=popular'); check('copy count went up', r.data.items.find((i: any) => i.id === quiz.id)?.copyCount === 1, r.data.items);
r = await call(tokA, 'GET', '/notifications'); check('the author is told about the copy', r.data.items.some((n: any) => /хуулж авлаа/.test(n.title)), r.data.items.map((n: any) => n.title));
r = await call(tokA, 'PATCH', `/quizzes/${quiz.id}`, { isPublic: false }); check('unpublish', r.status === 200 && r.data?.isPublic === false, r.data);
r = await call(tokC, 'GET', '/library'); check('unpublished quiz leaves the library', !r.data.items.some((i: any) => i.id === quiz.id));
r = await call(tokC, 'POST', `/library/${quiz.id}/copy`); check('and can no longer be copied (404)', r.status === 404, r);
check('the earlier copy survives unpublishing', (await call(tokB, 'GET', `/quizzes/${copy?.id}`)).status === 200);

// --- group announcements and comments
r = await call(tokB, 'POST', `/classes/${klass?.id}/posts`, { body: 'hi' }); check('members cannot post announcements (403)', r.status === 403, r);
r = await call(tokA, 'POST', `/classes/${klass?.id}/posts`, { body: '   ' }); check('empty announcement rejected (400)', r.status === 400, r);
r = await call(tokA, 'POST', `/classes/${klass?.id}/posts`, { body: 'x'.repeat(2001) }); check('too-long announcement rejected (400)', r.status === 400, r.status);
r = await call(tokA, 'POST', `/classes/${klass?.id}/posts`, { body: 'First announcement' });
check('admin posts an announcement', r.status === 201 && r.data?.length === 1 && r.data[0].body === 'First announcement' && r.data[0].author.name === 'E2E Admin', r.data);
r = await call(tokA, 'POST', `/classes/${klass?.id}/posts`, { body: 'Second announcement' }); const twoPosts = r.data;
check('newest announcement comes first', twoPosts[0].body === 'Second announcement' && twoPosts.length === 2, twoPosts.map((p: any) => p.body));
const firstPost = twoPosts.find((p: any) => p.body === 'First announcement'); const secondPost = twoPosts.find((p: any) => p.body === 'Second announcement');
r = await call(tokB, 'GET', '/notifications'); check('members are notified of an announcement', r.data.items.some((n: any) => /шинэ зарлал/.test(n.title)), r.data.items.map((n: any) => n.title));
r = await call(tokB, 'GET', `/classes/${klass?.id}/posts`); check('members can read announcements', r.status === 200 && r.data.length === 2 && r.data.every((p: any) => p.canDelete === false), r.data);
r = await call(tokA, 'GET', `/classes/${klass?.id}/posts`); check('admin can delete any announcement', r.data.every((p: any) => p.canDelete === true), r.data);
check('non-members cannot read announcements (404)', (await call(tokC, 'GET', `/classes/${klass?.id}/posts`)).status === 404);
check('bad group id -> 404', (await call(tokA, 'GET', '/classes/nope/posts')).status === 404);
r = await call(tokB, 'PATCH', `/posts/${firstPost?.id}`, { pinned: true }); check('members cannot pin (403)', r.status === 403, r);
r = await call(tokA, 'PATCH', `/posts/${firstPost?.id}`, { pinned: true }); check('admin pins an announcement', r.status === 200, r);
r = await call(tokA, 'GET', `/classes/${klass?.id}/posts`); check('pinned announcements sort first', r.data[0].id === firstPost?.id && r.data[0].pinned === true, r.data.map((p: any) => p.pinned));
r = await call(tokB, 'POST', `/posts/${firstPost?.id}/comments`, { body: '  ' }); check('empty comment rejected (400)', r.status === 400, r);
r = await call(tokC, 'POST', `/posts/${firstPost?.id}/comments`, { body: 'let me in' }); check('non-members cannot comment (404)', r.status === 404, r);
r = await call(tokB, 'POST', `/posts/${firstPost?.id}/comments`, { body: 'Thanks!' }); check('member comments', r.status === 201, r);
r = await call(tokA, 'POST', `/posts/${firstPost?.id}/comments`, { body: 'You are welcome' }); check('admin comments too', r.status === 201, r);
r = await call(tokA, 'GET', '/notifications'); check('the post author is told about a comment', r.data.items.some((n: any) => /сэтгэгдэл бичлээ/.test(n.title)), r.data.items.map((n: any) => n.title));
r = await call(tokB, 'GET', `/classes/${klass?.id}/posts`);
const pinned = r.data.find((p: any) => p.id === firstPost?.id);
check('comments are listed oldest first with delete rights', pinned.comments.length === 2 && pinned.comments[0].body === 'Thanks!' && pinned.comments[0].canDelete === true && pinned.comments[1].canDelete === false, pinned.comments);
const adminComment = pinned.comments[1], memberComment = pinned.comments[0];
r = await call(tokB, 'DELETE', `/comments/${adminComment.id}`); check("members cannot delete someone else's comment (403)", r.status === 403, r);
r = await call(tokC, 'DELETE', `/comments/${adminComment.id}`); check('non-members get 404 on comments', r.status === 404, r);
r = await call(tokA, 'DELETE', `/comments/${memberComment.id}`); check("admin deletes a member's comment", r.status === 200, r);
r = await call(tokB, 'DELETE', `/posts/${firstPost?.id}`); check('members cannot delete announcements (403)', r.status === 403, r);
r = await call(tokA, 'DELETE', `/posts/${secondPost?.id}`); check('admin deletes an announcement', r.status === 200, r);
r = await call(tokA, 'GET', `/classes/${klass?.id}/posts`); check('deleted announcement is gone, the other remains with its comment', r.data.length === 1 && r.data[0].id === firstPost?.id && r.data[0].comments.length === 1, r.data);
const fpost = new FormData(); fpost.append('body', ''); fpost.append('file', txt('slides.txt', 'slides'));
r = await call(tokA, 'POST', `/classes/${klass?.id}/posts`, undefined, fpost); const withFile = r.data?.find?.((p: any) => p.attachment);
check('an announcement can be just a file', r.status === 201 && withFile?.attachment?.fileName === 'slides.txt' && withFile?.body === '', r.data);
check('members can download it', (await call(tokB, 'GET', `/materials/${withFile?.attachment?.id}`)).status === 200);
r = await call(tokB, 'GET', `/classes/${klass?.id}/materials`); check('and it is in the group materials', r.data?.some((m: any) => m.id === withFile?.attachment?.id), r.data);
r = await call(tokB, 'GET', `/classes/${klass?.id}/posts?limit=1`); check('paging: every pinned one plus the newest of the rest', r.data?.length === 2 && r.data[0].pinned === true && r.data[1].id === withFile?.id, r.data?.map((p: any) => p.id));
await call(tokA, 'DELETE', `/materials/${withFile?.attachment?.id}`);
r = await call(tokB, 'GET', `/classes/${klass?.id}/posts`); check('deleting the file leaves the announcement without it', r.data?.find((p: any) => p.id === withFile?.id)?.attachment === null, r.data);
await call(tokA, 'DELETE', `/posts/${withFile?.id}`);

// --- deletion / leave / robustness
r = await call(tokA, 'GET', '/notes/not-a-uuid'); check('malformed id -> 404 (not 500)', r.status === 404, r.status);
r = await call(tokA, 'GET', '/materials/undefined'); check('malformed material id -> 404', r.status === 404, r.status);
r = await call(tokB, 'DELETE', `/quizzes/${gq?.id}`); check('member cannot delete group quiz (403)', r.status === 403, r);
r = await call(tokA, 'DELETE', `/quizzes/${gq?.id}`); check('quiz used by assignment -> 409', r.status === 409, r);
r = await call(tokA, 'DELETE', `/assignments/${asg?.id}`); check('admin deletes assignment (+submissions)', r.status === 200, r);
r = await call(tokB, 'DELETE', `/assignments/${asg?.id}`); check('deleted assignment -> 404', r.status === 404, r);
r = await call(tokA, 'DELETE', `/quizzes/${gq?.id}`); check('admin deletes group quiz (+games)', r.status === 200, r);
r = await call(tokA, 'DELETE', `/quizzes/${quiz?.id}`); check('owner deletes personal quiz', r.status === 200, r);
r = await call(tokA, 'GET', `/quizzes/${quiz?.id}`); check('deleted quiz gone', r.status === 404, r);
const q2 = await seedQuiz({ ownerId: userA?.id, noteId: pn?.id });
r = await call(tokA, 'DELETE', `/notes/${pn?.id}`); check('owner deletes personal note', r.status === 200, r);
r = await call(tokA, 'GET', `/quizzes/${q2?.id}`); check('quiz survives note deletion (sourceNoteId null)', r.status === 200 && r.data?.sourceNoteId === null, r.data);
r = await call(tokB, 'DELETE', `/notes/${sn?.id}`); check('member deletes shared note', r.status === 200, r);
r = await call(tokA, 'DELETE', `/classes/${klass?.id}/membership`); check('owner cannot leave (400)', r.status === 400, r);
r = await call(tokB, 'DELETE', `/classes/${klass?.id}`); check('member cannot delete group (403)', r.status === 403, r);
r = await call(tokB, 'DELETE', `/classes/${klass?.id}/membership`); check('member leaves group', r.status === 200, r);
r = await call(tokB, 'GET', `/classes/${klass?.id}`); check('left member loses access (404)', r.status === 404, r);
r = await call(tokB, 'POST', '/classes/join', { code: klass?.code }); check('can rejoin after leaving', r.status === 200, r);
r = await call(tokA, 'DELETE', `/classes/${klass?.id}`); check('owner deletes group (cascade)', r.status === 200, r);
r = await call(tokA, 'GET', `/classes/${klass?.id}`); check('deleted group -> 404', r.status === 404, r);
r = await call(tokB, 'GET', '/me/classes'); check('deleted group gone from member list', !r.data?.some((c: any) => c.id === klass?.id), r);


// --- delete account (B) after everything else
r = await call(tokB, 'DELETE', '/me', { password: 'nope' }); check('account delete needs correct password', r.status === 400, r);
r = await call(tokB, 'DELETE', '/me', { password: 'newsecret1' }); check('delete account', r.status === 200, r);
r = await call(tokB, 'GET', '/auth/me'); check('deleted account token no longer works', r.status === 401, r.status);

// --- rate limit: hammer login with a wrong password
let limited = false;
for (let i = 0; i < 14 && !limited; i++) limited = (await call(null, 'POST', '/auth/login', { email: `nobody-${stamp}@example.test`, password: 'x' })).status === 429;
check('login is rate limited (429)', limited);

await sql.end();
console.log(JSON.stringify({ users: [userA?.id, userB?.id], klass: klass?.id, out }, null, 0));
const fails = results.filter((x) => !x.ok);
console.log(`PASS ${results.length - fails.length}/${results.length}`);
for (const f of fails) console.log('FAIL', f.name, f.info);
