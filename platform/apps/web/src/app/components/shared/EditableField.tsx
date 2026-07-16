import { useEffect, useRef, useState, type ElementType } from 'react';
import clsx from 'clsx';

interface EditableFieldProps {
  value: string;
  baseValue?: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  as?: ElementType;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}

export function EditableField({
  value,
  baseValue,
  onSave,
  multiline = false,
  as: Tag = 'div',
  className,
  style,
  placeholder,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const edited = baseValue !== undefined && value !== baseValue;

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    const commit = () => { const v = draft.trim(); onSave(v || value); setEditing(false); };
    const cancel = () => { setDraft(value); setEditing(false); };
    const shared = {
      ref: inputRef,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        if (!multiline && e.key === 'Enter') { e.preventDefault(); commit(); }
      },
      placeholder,
    };
    return multiline
      ? <textarea {...shared} rows={Math.max(3, draft.split('\n').length + 1)} className={clsx('block w-full resize-none rounded border border-[var(--color-steel)] bg-white px-2 py-1.5 text-sm leading-6 outline-none shadow-sm', className)} style={style} />
      : <input {...shared} className={clsx('block w-full rounded border border-[var(--color-steel)] bg-white px-2 py-1 text-sm outline-none shadow-sm', className)} style={style} />;
  }

  return (
    <Tag
      className={clsx('group relative cursor-text rounded transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]', className)}
      style={style}
      onDoubleClick={() => { setDraft(value); setEditing(true); }}
      title="Double-click to edit"
    >
      {value || <span className="opacity-40">{placeholder}</span>}
      {edited && (
        <span
          className="pointer-events-none absolute right-0 top-0 translate-x-1/4 -translate-y-1/3 select-none rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            color: 'var(--color-warm-gray)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          edited
        </span>
      )}
    </Tag>
  );
}
