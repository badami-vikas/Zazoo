import type { CardData } from './types';

const KEY = 'card-scanner-v2';

export interface StoredContact extends CardData {
  dateAdded: string;
}

export function loadContacts(): StoredContact[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function splitMulti(val: string): string[] {
  return val.split('|').map(s => s.trim()).filter(Boolean);
}

function mergeMulti(a: string, b: string): string {
  const seen = new Set<string>();
  return [...splitMulti(a), ...splitMulti(b)]
    .filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .join(' | ');
}

function mergeContacts(existing: StoredContact, incoming: StoredContact): StoredContact {
  return {
    name:       existing.name       || incoming.name,
    role:       existing.role       || incoming.role,
    company:    existing.company    || incoming.company,
    email:      mergeMulti(existing.email,      incoming.email),
    phone:      mergeMulti(existing.phone,      incoming.phone),
    address:    existing.address    || incoming.address    || '',
    website:    mergeMulti(existing.website    ?? '', incoming.website    ?? ''),
    additional: mergeMulti(existing.additional, incoming.additional),
    dateAdded:  existing.dateAdded,
  };
}

export function saveContact(data: CardData): number {
  const list = loadContacts();
  const nameKey = data.name.trim().toLowerCase();
  if (nameKey) {
    const idx = list.findIndex(c => c.name.trim().toLowerCase() === nameKey);
    if (idx !== -1) {
      list[idx] = mergeContacts(list[idx], { ...data, dateAdded: list[idx].dateAdded });
      localStorage.setItem(KEY, JSON.stringify(list));
      return list.length;
    }
  }
  list.push({ ...data, dateAdded: new Date().toISOString().slice(0, 16).replace('T', ' ') });
  localStorage.setItem(KEY, JSON.stringify(list));
  return list.length;
}

export function contactCount(): number {
  return loadContacts().length;
}

function escapeField(val: string): string {
  const s = String(val ?? '');
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function splitPair(val: string): [string, string] {
  const parts = splitMulti(val);
  return [parts[0] ?? '', parts[1] ?? ''];
}

export function buildCSV(): string {
  const list = loadContacts().filter(c => c.name || c.role || c.company || c.email || c.phone);
  if (!list.length) return '';
  const headers = ['Name', 'Role', 'Company', 'Email 1', 'Email 2', 'Phone 1', 'Phone 2', 'Address', 'Website', 'Additional', 'Date Added'];
  const rows = list.map(c => {
    const [email1, email2] = splitPair(c.email);
    const [phone1, phone2] = splitPair(c.phone);
    return [c.name, c.role, c.company, email1, email2, phone1, phone2, c.address ?? '', c.website ?? '', c.additional, c.dateAdded];
  });
  return [headers, ...rows].map(r => r.map(escapeField).join(',')).join('\n');
}

export function downloadCSV(filename = 'contacts'): void {
  const csv = buildCSV();
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${filename.trim() || 'contacts'}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
