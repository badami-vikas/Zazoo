import { useSyncExternalStore } from 'react';

export interface SchedulableTask { id: string; title: string; scheduledDate?: string }
export interface ColumnPreference { width?: number; hidden?: boolean }
export interface TaskManagerState {
  schedules?: Record<string, string>;
  columns?: Record<string, ColumnPreference>;
}

const STORAGE_KEY = 'bridge.task-manager.v1';

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function allocatePendingWork<T extends SchedulableTask>(tasks: T[], start: Date, days: number): Array<T & { scheduledDate: string }> {
  if (days < 1) return tasks.map((task) => ({ ...task, scheduledDate: task.scheduledDate ?? isoDay(start) }));
  return tasks.map((task, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + (index % days));
    return { ...task, scheduledDate: isoDay(day) };
  });
}

export function reconcileTaskSchedules(
  tasks: SchedulableTask[],
  schedules: Record<string, string>,
  start: Date,
  days: number,
): Record<string, string> {
  const missing = tasks.filter((task) => !schedules[task.id]);
  if (missing.length === 0) return schedules;
  const allocated = allocatePendingWork(missing, start, days);
  return { ...schedules, ...Object.fromEntries(allocated.map((task) => [task.id, task.scheduledDate])) };
}

export function moveScheduledTask<T extends SchedulableTask>(tasks: T[], id: string, scheduledDate: string): Array<T & { scheduledDate?: string }> {
  return tasks.map((task) => task.id === id ? { ...task, scheduledDate } : task);
}

export function updateColumnPreference(state: Record<string, ColumnPreference>, id: string, patch: ColumnPreference): Record<string, ColumnPreference> {
  return { ...state, [id]: { ...state[id], ...patch } };
}

function load(): TaskManagerState {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as TaskManagerState : {};
  } catch { return {}; }
}

let state = load();
const subscribers = new Set<() => void>();
export function persistTaskManagerState(next: TaskManagerState) {
  state = next;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local plane unavailable */ }
  subscribers.forEach((subscriber) => subscriber());
}

export function useTaskManagerState(): TaskManagerState {
  return useSyncExternalStore(
    (subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    () => state,
    () => ({}),
  );
}
