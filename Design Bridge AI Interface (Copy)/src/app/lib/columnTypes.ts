export type ColumnType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'checkbox'
  | 'email'
  | 'url'
  | 'phone';

export const COLUMN_TYPES: { id: ColumnType; label: string }[] = [
  { id: 'text',        label: 'Text' },
  { id: 'number',      label: 'Number' },
  { id: 'select',      label: 'Select' },
  { id: 'multiselect', label: 'Multi-select' },
  { id: 'date',        label: 'Date' },
  { id: 'checkbox',    label: 'Checkbox' },
  { id: 'email',       label: 'Email' },
  { id: 'url',         label: 'URL' },
  { id: 'phone',       label: 'Phone' },
];

/** These types open a popover (or toggle) on cell-click; GlideTable should NOT inline-edit them. */
export const POPOVER_TYPES: ColumnType[] = ['select', 'multiselect', 'date'];

/** These types can be edited inline by GlideTable's overlay editor. */
export const INLINE_TYPES: ColumnType[] = ['text', 'number', 'email', 'url', 'phone'];
