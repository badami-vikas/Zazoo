import type { CardData } from './types';

const KEY = 'card-scanner-feedback-v1';

export interface FeedbackItem {
  id: string;
  original: CardData;
  corrected: CardData;
  model: string;
  ts: string;
}

export function loadFeedback(): FeedbackItem[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function saveFeedback(item: Omit<FeedbackItem, 'id' | 'ts'>): void {
  const list = loadFeedback();
  list.unshift({ ...item, id: Date.now().toString(), ts: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 10)));
}

export function feedbackCount(): number {
  return loadFeedback().length;
}

function diffFields(orig: CardData, corr: CardData): string {
  return (Object.keys(orig) as (keyof CardData)[])
    .filter(k => orig[k] !== corr[k])
    .map(k => `  ${k}: "${orig[k]}" → "${corr[k]}"`)
    .join('\n');
}

export function buildFewShotBlock(items: FeedbackItem[]): string {
  if (!items.length) return '';
  const entries = items
    .slice(0, 3)
    .map((x, i) => {
      const diff = diffFields(x.original, x.corrected);
      return diff ? `Past correction ${i + 1}:\n${diff}` : null;
    })
    .filter(Boolean);
  if (!entries.length) return '';
  return `Apply these past user corrections to improve accuracy:\n${entries.join('\n\n')}\n\n`;
}
