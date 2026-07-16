import { usePersistentState } from './persist';

export function useLocalEdits(entityKey: string) {
  const [edits, setEdits] = usePersistentState<Record<string, string>>(
    `bridge.edits.v1.${entityKey}`,
    {},
  );

  const setEdit = (field: string, value: string) =>
    setEdits((prev) => ({ ...prev, [field]: value }));

  const fieldValue = (field: string, base: string): string =>
    edits[field] ?? base;

  const isEdited = (field: string, base: string): boolean =>
    field in edits && edits[field] !== base;

  const clearEdit = (field: string) =>
    setEdits((prev) => { const next = { ...prev }; delete next[field]; return next; });

  return { edits, setEdit, fieldValue, isEdited, clearEdit };
}
