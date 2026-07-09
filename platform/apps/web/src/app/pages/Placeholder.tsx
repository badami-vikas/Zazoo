export function Placeholder({ name }: { name: string }) {
  return (
    <div className="p-6 text-sm text-muted-foreground">
      {name} — not yet ported. See docs/raw/frontend-migration-scoping.md Phase 1.
    </div>
  );
}
