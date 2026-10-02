import { beforeEach, describe, expect, it } from 'bun:test';
import { levelForXp, xpAtLevelStart, xpToNextLevel } from '@/lib/points/level';
import {
  DAILY_GAME_COIN_CAP,
  MIN_PLAYERS_FOR_REWARDS,
  assignmentCoins,
  assignmentXp,
  startOfTodayUb,
  todayUb,
} from '@/lib/points/rules';
import { isUuid } from '@/lib/uuid';
import { BADGES, BADGE_BY_KEY } from '@/lib/badges';
import { normalizeMime } from '@/lib/materials';
import { matchesSignature } from '@/lib/fileSignature';
import { rateLimit, resetRateLimits } from '@/lib/rateLimit';
import { formatSize, optionalText } from '@/lib/text';
import { dueDateInput, dueInputValue, dueTimeInput, formatDue, parseDueInput } from '@/lib/dueDate';
import { gradesCsv, safeFileName } from '@/lib/gradesCsv';
import { checkAnswers, withoutAnswers } from '@/lib/quiz/answers';
import type { Question, Quiz } from '@/lib/types';
import { randomCode } from '@/lib/codes';

describe('levelForXp', () => {
  it('levels get progressively harder: 100, 150, 200, ... xp per level', () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, xpIntoLevel: 0, xpForNextLevel: 100 });
    expect(levelForXp(99)).toMatchObject({ level: 1, xpIntoLevel: 99 });
    expect(levelForXp(100)).toMatchObject({ level: 2, xpIntoLevel: 0, xpForNextLevel: 150 });
    expect(levelForXp(249).level).toBe(2);
    expect(levelForXp(250)).toMatchObject({ level: 3, xpForNextLevel: 200 });
    expect(levelForXp(450).level).toBe(4);
    expect(levelForXp(700).level).toBe(5);
  });
  it('level thresholds match the per-level costs', () => {
    for (let level = 1; level < 30; level++) {
      expect(xpAtLevelStart(level + 1) - xpAtLevelStart(level)).toBe(xpToNextLevel(level));
      expect(levelForXp(xpAtLevelStart(level)).level).toBe(level);
      expect(levelForXp(xpAtLevelStart(level + 1) - 1).level).toBe(level);
    }
  });
});

describe('economy rules', () => {
  it('assignment rewards scale with the score', () => {
    expect(assignmentXp(100)).toBe(50);
    expect(assignmentCoins(100)).toBe(10);
    expect(assignmentXp(0)).toBe(0);
  });
  it('uses the Ulaanbaatar calendar day (UTC+8), not UTC', () => {
    // 20:00 UTC on the 1st is already the 2nd in Ulaanbaatar
    expect(todayUb(new Date('2026-10-01T20:00:00Z'))).toBe('2026-10-02');
    expect(todayUb(new Date('2026-10-01T10:00:00Z'))).toBe('2026-10-01');
    expect(startOfTodayUb(new Date('2026-10-01T20:00:00Z')).toISOString()).toBe('2026-10-01T16:00:00.000Z');
  });
  it('a game needs a few players before it pays out', () => {
    expect(MIN_PLAYERS_FOR_REWARDS).toBeGreaterThanOrEqual(3);
    expect(DAILY_GAME_COIN_CAP).toBeGreaterThan(0);
  });
});

describe('isUuid', () => {
  it('accepts uuids and rejects everything else', () => {
    expect(isUuid('986ddfdb-e9d0-4370-9530-62e9fa056967')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('undefined')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});

describe('normalizeMime', () => {
  it('strips parameters and lowercases', () => {
    expect(normalizeMime('text/plain;charset=utf-8')).toBe('text/plain');
    expect(normalizeMime('IMAGE/PNG')).toBe('image/png');
    expect(normalizeMime('')).toBe('application/octet-stream');
  });
});

describe('matchesSignature', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it('accepts matching content', () => {
    expect(matchesSignature('image/png', png)).toBe(true);
    expect(matchesSignature('application/pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(matchesSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesSignature('text/plain;charset=utf-8', new TextEncoder().encode('hello'))).toBe(true);
  });
  it('rejects mismatched or unknown content', () => {
    expect(matchesSignature('image/png', Uint8Array.from([1, 2, 3, 4]))).toBe(false);
    expect(matchesSignature('application/pdf', png)).toBe(false);
    expect(matchesSignature('text/plain', Uint8Array.from([104, 0, 105]))).toBe(false);
    expect(matchesSignature('application/x-msdownload', png)).toBe(false);
  });
});

describe('rateLimit', () => {
  beforeEach(resetRateLimits);
  it('allows up to the limit then returns 429 with Retry-After', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('k', 3, 60_000)).toBeNull();
    const blocked = rateLimit('k', 3, 60_000);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
  it('tracks keys independently', () => {
    for (let i = 0; i < 3; i++) rateLimit('a', 3, 60_000);
    expect(rateLimit('b', 3, 60_000)).toBeNull();
  });
});

describe('optionalText / randomCode', () => {
  it('trims to null for blank input', () => {
    expect(optionalText('  ')).toBeNull();
    expect(optionalText(' hi ')).toBe('hi');
    expect(optionalText(5)).toBeNull();
  });
  it('makes codes of the requested length', () => {
    expect(randomCode(5)).toHaveLength(5);
  });
});

describe('badge catalogue', () => {
  it('has unique keys with a name and a hint each', () => {
    expect(new Set(BADGES.map((b) => b.key)).size).toBe(BADGES.length);
    for (const b of BADGES) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.hint.length).toBeGreaterThan(0);
      expect(BADGE_BY_KEY.get(b.key)).toBe(b);
    }
  });
  it('covers every key the server grants', () => {
    for (const key of ['first_note', 'first_quiz', 'team_player', 'first_win', 'perfect_score', 'streak_7', 'streak_30', 'level_5', 'level_10', 'popular_author']) {
      expect(BADGE_BY_KEY.has(key)).toBe(true);
    }
  });
});

describe('due dates', () => {
  it('a date alone means the end of that day in Ulaanbaatar', () => {
    const due = parseDueInput(dueInputValue('2026-10-05', ''))!;
    expect(due.toISOString()).toBe('2026-10-05T15:59:59.000Z');
    expect(dueDateInput(due.toISOString())).toBe('2026-10-05');
    expect(dueTimeInput(due.toISOString())).toBe('');
  });
  it('a date and time round-trip through the inputs', () => {
    const due = parseDueInput(dueInputValue('2026-10-05', '18:30'))!;
    expect(due.toISOString()).toBe('2026-10-05T10:30:00.000Z');
    expect(dueDateInput(due.toISOString())).toBe('2026-10-05');
    expect(dueTimeInput(due.toISOString())).toBe('18:30');
  });
  it('no date means no deadline, even with a time', () => {
    expect(dueInputValue('', '18:30')).toBeNull();
    expect(parseDueInput(null)).toBeNull();
    expect(parseDueInput('not a date')).toBeUndefined();
  });
  it('the label shows a time only when one was picked', () => {
    expect(formatDue(new Date('2026-10-05T23:59:59+08:00'))).not.toContain(':');
    expect(formatDue(new Date('2026-10-05T18:00:00+08:00'))).toEndWith(', 18:00');
  });
});

describe('formatSize', () => {
  it('picks a readable unit', () => {
    expect(formatSize(812)).toBe('812 B');
    expect(formatSize(45 * 1024)).toBe('45 KB');
    expect(formatSize(1.25 * 1024 * 1024)).toBe('1.3 MB');
  });
});

describe('gradesCsv', () => {
  const grades = {
    assignments: [
      { id: 'a1', title: 'HW, part 1', dueAt: null },
      { id: 'a2', title: 'Essay', dueAt: null },
    ],
    students: [
      {
        id: 's1',
        name: 'Болд',
        cells: { a1: { score: 90, submittedAt: '', late: false }, a2: { score: null, submittedAt: '', late: true } },
        average: 90,
      },
      { id: 's2', name: '=HYPERLINK("x")', cells: { a1: null, a2: null }, average: null },
    ],
  };
  const csv = gradesCsv(grades);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it('quotes cells with commas and lists scores, ungraded and missing work', () => {
    expect(lines[0]).toBe('Гишүүн,"HW, part 1",Essay,Дундаж');
    expect(lines[1]).toBe('Болд,90,илгээсэн,90');
  });
  it('defuses names Excel would run as a formula', () => {
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",,,`);
  });
  it('makes a safe file name', () => {
    expect(safeFileName('8/А анги: дүн?')).toBe('8-А анги- дүн-');
    expect(safeFileName('  ')).toBe('file');
  });
});

describe('quiz answer key', () => {
  const questions: Question[] = [
    { id: 'q1', prompt: '1+1?', options: ['1', '2', '3', '4'], correctIndex: 1, explanation: 'Two.' },
    { id: 'q2', prompt: '2+2?', options: ['4', '5', '6', '7'], correctIndex: 0 },
  ];
  it('withoutAnswers drops the key and explanations', () => {
    const quiz = { id: 'z', title: 'T', questions } as unknown as Quiz;
    const hidden = withoutAnswers(quiz);
    expect(hidden.answersHidden).toBe(true);
    expect(hidden.questions[0]).toEqual({ id: 'q1', prompt: '1+1?', options: ['1', '2', '3', '4'] });
    expect(JSON.stringify(hidden)).not.toContain('correctIndex');
    expect(JSON.stringify(hidden)).not.toContain('Two.');
  });
  it('checkAnswers says what was right, and reveals the key only when allowed', () => {
    const picks = [
      { questionId: 'q1', optionIndex: 1 },
      { questionId: 'q2', optionIndex: 3 },
      { questionId: 'nope', optionIndex: 0 },
    ];
    expect(checkAnswers(questions, picks, false)).toEqual([
      { questionId: 'q1', correct: true },
      { questionId: 'q2', correct: false },
    ]);
    expect(checkAnswers(questions, picks, true)).toEqual([
      { questionId: 'q1', correct: true, correctIndex: 1, explanation: 'Two.' },
      { questionId: 'q2', correct: false, correctIndex: 0, explanation: undefined },
    ]);
  });
});
