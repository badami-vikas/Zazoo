import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { useDismiss } from "../../lib/useDismiss";
import {
  AddColumnDialog,
  CHOICE_KINDS,
  COLUMN_TYPES,
  ColumnOptionsEditor,
  type ColumnDraft,
  type ColumnTypeName,
} from "./AddColumnDialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";

export interface MenuPosition {
  x: number;
  y: number;
}

export function clampMenuPosition(position: MenuPosition): MenuPosition {
  const margin = 8;
  const width = 224;
  const height = Math.min(window.innerHeight * 0.7, 420);
  return {
    x: Math.max(margin, Math.min(position.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(position.y, window.innerHeight - height - margin)),
  };
}

/** One source of breakage in a delete preview, and — the point of the shape —
 * whether it was actually looked at. Mirrors the server's `DependencySource`;
 * declared structurally so the web app does not import the API's types. */
export interface DependencySource {
  inspected: boolean;
  items: string[];
  note: string | null;
}

export interface ColumnDependencyPreview {
  columnId: string;
  views: DependencySource;
  automations: DependencySource;
  skills: DependencySource;
  formulas: DependencySource;
  relations: DependencySource;
}

/**
 * What the SERVER said this surface can do to this Database's columns.
 *
 * Never inferred on the client. TASK-084's dependency note is the whole reason:
 * a menu item enabled against a capability that is not there ships a control
 * that looks live and fails at the server, which ADR-247 forbids. `available:
 * false` carries the reason, and the reason is what the disabled item says.
 */
export interface ColumnSchemaCapability {
  available: boolean;
  reason: string | null;
  canUndo?: boolean;
  /** Whether this Database's ROW STORE can hold a column its shipped spec never
   * declared — a separate answer from `available`, because reshaping the
   * columns that exist and gaining a new one are different capabilities. */
  canAddColumn?: boolean;
  /** Why it cannot, as the SERVER said it. Never composed on the client. */
  addReason?: string | null;
}

/** Re-exported so every existing consumer keeps its one import: the list and
 * the type now live beside the dialog that offers them (TASK-112). */
export type { ColumnTypeName };

export interface StandardColumnMenuItemProps {
  label: string;
  databaseBacked: boolean;
  onFilter: () => void;
  onSort: (direction: "asc" | "desc") => void;
  onGroup?: () => void;
  /** Is this the column the View is grouped by? The command reads as the way
   *  back out, not as a second grouping. */
  grouped?: boolean;
  onHide?: () => void;
  /** Shown as the tooltip on the column name (`ColumnSpec.description`). */
  description?: string;

  // ── View mechanics reached from any column (TASK-109) ────────────────────
  /** Freeze every column up to and including this one, or unfreeze. */
  onFreeze?: () => void;
  frozen?: boolean;
  onToggleWrap?: () => void;
  wrapped?: boolean;
  /** The View's current row height, shown on the command that advances it. */
  rowHeight?: "short" | "medium" | "tall";
  onRowHeight?: () => void;
  /** Add a column of THIS column's type beside it, through the same governed
   *  add path. Values are not copied — no server command copies them. */
  onDuplicateColumn?: (label: string) => Promise<void>;

  // ── The governed schema-mutation capability (TASK-084) ───────────────────
  /** The column's stable id, shown in the rename warning so a person can see
   * that a rename is a LABEL change and their filters keep working. */
  columnId?: string;
  columnKind?: ColumnTypeName;
  locked?: boolean;
  capability?: ColumnSchemaCapability | null;
  onRename?: (label: string) => Promise<void>;
  onChangeType?: (kind: ColumnTypeName, options: string[]) => Promise<void>;
  onSetLocked?: (locked: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** Add a column beside this one. Present only where the server said this
   * Database's row store can hold a column its spec never declared. Takes the
   * whole draft the shared dialog collected — name, type and, for a choice
   * kind, its choices (TASK-112). */
  onAddColumn?: (draft: ColumnDraft, side: "left" | "right") => Promise<void>;
  /** Fetches the dependency preview shown in the delete warning. */
  onPreviewDelete?: () => Promise<ColumnDependencyPreview>;
  onUndo?: () => Promise<void>;
}

/** A menu row. Disabled is never bare: a control that cannot act stays VISIBLE
 * and says why (ADR-001, rulebook §3a). */
function MenuItem({
  label,
  disabledReason,
  onSelect,
}: {
  label: string;
  disabledReason?: string;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={Boolean(disabledReason)}
      title={disabledReason}
      onClick={onSelect}
      className="w-full px-3 py-1.5 text-left text-xs hover:bg-black/5 disabled:opacity-45 disabled:hover:bg-transparent dark:hover:bg-white/10"
    >
      {label}
    </button>
  );
}

/** A command the surface CAN run, held one beat so the person sees what it
 * does before it does it. This replaces refusal, not confirmation: the
 * consequence is stated and the command then proceeds (AP-168). */
interface PendingCommand {
  title: string;
  consequence: string;
  detail?: ReactNode;
  input?: { kind: "text"; value: string } | { kind: "columnType"; value: ColumnTypeName };
  /** The retype path's choices, sent alongside the new kind (TASK-112). */
  runWithOptions?: (value: string, options: string[]) => Promise<void>;
  confirmLabel: string;
  run: (value: string) => Promise<void>;
}

function DependencyList({ name, source }: { name: string; source: DependencySource }) {
  return (
    <li>
      <span className="font-medium">{name}:</span>{" "}
      {source.items.length > 0 ? (
        <span>{source.items.join("; ")}</span>
      ) : source.inspected ? (
        <span>none found</span>
      ) : (
        <span style={{ color: "var(--color-danger)" }}>not inspected</span>
      )}
      {source.note && (
        <div className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          {source.note}
        </div>
      )}
    </li>
  );
}

/**
 * The menu itself, split out from its trigger so any surface can show the SAME
 * items with the SAME reasons (AP-021).
 *
 * WHAT CHANGED (TASK-084 / AP-168). 13 of the 17 items were permanently
 * disabled because nothing stood behind them. `tableSchema` now does, and the
 * items enable against what the SERVER reports — with a stated consequence
 * rather than a refusal. The ones still disabled are the ones that genuinely
 * cannot run here, and each says which of the two it is.
 *
 * The panel stays separately mountable and viewport-clamped: it is
 * `position: fixed`, so it can be opened from anywhere without inheriting a
 * <th>'s uppercase/tracking or its overflow clipping.
 */
export function StandardColumnMenuPanel({
  label,
  databaseBacked,
  onFilter,
  onSort,
  onGroup,
  grouped,
  onHide,
  onFreeze,
  frozen,
  onToggleWrap,
  wrapped,
  rowHeight,
  onRowHeight,
  onDuplicateColumn,
  columnId,
  columnKind,
  locked,
  capability,
  onRename,
  onChangeType,
  onSetLocked,
  onDelete,
  onAddColumn,
  onPreviewDelete,
  onUndo,
  position,
  onClose,
}: StandardColumnMenuItemProps & { position: MenuPosition; onClose: () => void }) {
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [draft, setDraft] = useState("");
  /** The choices a retype names, and which side an add lands on. Both feed the
   * SAME editor/dialog the toolbar's Add column uses (TASK-112). */
  const [options, setOptions] = useState<string[]>([]);
  const [addSide, setAddSide] = useState<"left" | "right" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // While a warning dialog is open the menu must not dismiss under it — the
  // dialog owns the interaction until the person answers it.
  useDismiss(!pending && addSide === null, onClose);

  const open = (command: PendingCommand) => {
    setFailure(null);
    setDraft(command.input?.value ?? "");
    setOptions([]);
    setPending(command);
  };

  /**
   * Why a schema command cannot run here, or `undefined` when it can.
   *
   * The server's own words when it reported the capability absent — never a
   * reason invented on the client, which could disagree with what the server
   * would actually do.
   */
  const schemaReason = (handler: unknown): string | undefined => {
    if (capability && !capability.available) return capability.reason ?? "Unavailable here";
    if (!capability) {
      return "Unavailable: this surface has not been given a governed schema-mutation capability";
    }
    if (!handler) return "Unavailable: this View does not route schema changes";
    return undefined;
  };

  /** Commands with nowhere to write — for a Database whose rows ARE sqlite
   * columns, a new column has no store for its values. Whether that is true
   * here is the SERVER's answer (`canAddColumn`/`addReason`), not a blanket
   * claim: a Module Database keeps its Records as documents of the columns its
   * resolved spec declares, so it can gain one. */
  const noStoreReason =
    "Unavailable: this Database's columns ship with the Module and there is nowhere to store a column it does not have — rename, retype, lock and delete are available";

  /** Why a column cannot be added here, or `undefined` when it can. */
  const addReason = (): string | undefined => {
    const blocked = schemaReason(onAddColumn);
    if (blocked) return blocked;
    if (!capability?.canAddColumn) return capability?.addReason ?? noStoreReason;
    return undefined;
  };

  const busyReason = busy
    ? "Working…"
    : pending?.input?.kind === "columnType" &&
        CHOICE_KINDS.includes(draft as ColumnTypeName) &&
        options.length === 0
      ? "Add at least one option, or choose a type that does not have any"
      : undefined;

  return (
    <>
      <div
        role="menu"
        aria-label={`${label} column actions`}
        className="fixed z-[80] max-h-[min(70vh,420px)] w-56 overflow-auto rounded-xl border py-1 text-left normal-case tracking-normal shadow-xl"
        // `--popover` rather than a `bg-white` class: this panel is the same
        // kind of surface as `DropdownMenuContent` (which `StandardRowMenu`
        // renders), and that token is the one the `.dark` block overrides.
        // NOT `--color-surface`: the `@theme inline` block re-declares it
        // from a frozen light hex AFTER `.dark`, so it does not survive a
        // dark-mode flip.
        style={{
          left: position.x,
          top: position.y,
          borderColor: "var(--color-border)",
          background: "var(--popover)",
          color: "var(--popover-foreground)",
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MenuItem
          label="Rename"
          disabledReason={schemaReason(onRename)}
          onSelect={() =>
            open({
              title: `Rename “${label}”`,
              consequence: `This changes the label only. The stored column id (${columnId ?? "unchanged"}) stays as it is, so every Filter, Sort and formula that names this column keeps working.`,
              input: { kind: "text", value: label },
              confirmLabel: "Rename",
              run: async (value) => {
                await onRename?.(value);
              },
            })
          }
        />
        <MenuItem
          label="Change type"
          disabledReason={schemaReason(onChangeType)}
          onSelect={() =>
            open({
              title: `Change the type of “${label}”`,
              consequence:
                "Stored values are not rewritten — they are re-read as the new type. A value the new type cannot read renders empty until it is entered again.",
              input: { kind: "columnType", value: columnKind ?? "text" },
              confirmLabel: "Change type",
              run: async (value) => {
                await onChangeType?.(value as ColumnTypeName, []);
              },
              runWithOptions: async (value, chosen) => {
                await onChangeType?.(value as ColumnTypeName, chosen);
              },
            })
          }
        />
        <MenuItem
          label="AI Smartfill"
          // Not a risk judgement: there is no fill capability behind it, so an
          // enabled item would produce nothing.
          disabledReason="Unavailable: no Smartfill capability is installed, so nothing would generate the values"
        />
        <MenuItem
          label="Filter"
          onSelect={() => {
            onFilter();
            onClose();
          }}
        />
        <MenuItem
          label="Sort ascending"
          onSelect={() => {
            onSort("asc");
            onClose();
          }}
        />
        <MenuItem
          label="Sort descending"
          onSelect={() => {
            onSort("desc");
            onClose();
          }}
        />
        <MenuItem
          label={grouped ? "Ungroup" : "Group"}
          // TASK-109 wired it: TableView passes `onGroup` now, so this is only
          // disabled on a surface that genuinely cannot persist a View change.
          disabledReason={onGroup ? undefined : "Unavailable: this surface cannot persist a View change"}
          onSelect={() => {
            onGroup?.();
            onClose();
          }}
        />
        <MenuItem
          label="Calculate"
          // Present and honest: the column summary IS available, one row down.
          // Pointing at it beats duplicating the picker in two places.
          disabledReason="Unavailable here: choose this column's summary from the table's own footer row"
        />
        <MenuItem
          label={locked ? "Unlock column" : "Lock column"}
          disabledReason={schemaReason(onSetLocked)}
          onSelect={() =>
            open({
              title: locked ? `Unlock “${label}”` : `Lock “${label}”`,
              consequence: locked
                ? "Cells in this column become editable again for anyone who can edit the Record."
                : "Cells in this column stop accepting edits, including yours, until it is unlocked. Stored values are untouched.",
              confirmLabel: locked ? "Unlock" : "Lock",
              run: async () => {
                await onSetLocked?.(!locked);
              },
            })
          }
        />
        <MenuItem
          label="Hide column"
          disabledReason={onHide ? undefined : "Unavailable: this surface cannot persist column visibility"}
          onSelect={() => {
            onHide?.();
            onClose();
          }}
        />
        <MenuItem
          label={frozen ? "Unfreeze columns" : "Freeze up to this column"}
          disabledReason={onFreeze ? undefined : "Unavailable: this surface cannot persist a View change"}
          onSelect={() => {
            onFreeze?.();
            onClose();
          }}
        />
        <MenuItem
          label={wrapped ? "Stop wrapping cells" : "Wrap cells"}
          disabledReason={onToggleWrap ? undefined : "Unavailable: this surface cannot persist a View change"}
          onSelect={() => {
            onToggleWrap?.();
            onClose();
          }}
        />
        <MenuItem
          label={`Row height: ${rowHeight ?? "short"}`}
          disabledReason={onRowHeight ? undefined : "Unavailable: this surface cannot persist a View change"}
          onSelect={() => {
            onRowHeight?.();
            onClose();
          }}
        />
        <MenuItem
          label="Add column left"
          disabledReason={addReason()}
          onSelect={() => setAddSide("left")}
        />
        <MenuItem
          label="Add column right"
          disabledReason={addReason()}
          onSelect={() => setAddSide("right")}
        />
        <MenuItem
          label="Duplicate column"
          disabledReason={onDuplicateColumn ? addReason() : noStoreReason}
          onSelect={() =>
            open({
              title: `Duplicate “${label}”`,
              consequence:
                "The new column arrives beside this one with the same type and NO values — nothing here copies a column's values, so it starts empty and you fill it.",
              input: { kind: "text", value: `${label} copy` },
              confirmLabel: "Duplicate column",
              run: async (value) => {
                await onDuplicateColumn?.(value);
              },
            })
          }
        />
        <MenuItem
          label="Delete column"
          disabledReason={schemaReason(onDelete)}
          onSelect={async () => {
            const preview = await onPreviewDelete?.();
            open({
              title: `Delete “${label}”`,
              consequence:
                "The column stops rendering everywhere this Database is shown. Stored values are not erased, and this can be undone — but anything below that names the column breaks until you do.",
              detail: preview ? (
                <ul className="mt-2 space-y-1 text-xs">
                  <DependencyList name="Views" source={preview.views} />
                  <DependencyList name="Automations" source={preview.automations} />
                  <DependencyList name="Skills" source={preview.skills} />
                  <DependencyList name="Formulas" source={preview.formulas} />
                  <DependencyList name="Relations" source={preview.relations} />
                </ul>
              ) : undefined,
              confirmLabel: "Delete column",
              run: async () => {
                await onDelete?.();
              },
            });
          }}
        />
        <MenuItem
          label="Undo last column change"
          disabledReason={
            capability?.canUndo && onUndo ? undefined : "Nothing to undo: no column change is recorded here"
          }
          onSelect={async () => {
            setBusy(true);
            try {
              await onUndo?.();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        />
        {databaseBacked && (
          <>
            <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
            <MenuItem label="Add page" disabledReason="This Database already has a Page" />
            <MenuItem
              label="Remove page"
              disabledReason="Unavailable: Page lifecycle is not part of the column capability — a Page is removed by uninstalling or reconfiguring the Module"
            />
          </>
        )}
      </div>

      {/* ADD COLUMN — the same dialog the toolbar's Add column opens, so a
          column added from the header and a column added from the toolbar ask
          the identical questions (TASK-112). */}
      <AddColumnDialog
        open={addSide !== null}
        title={`Add a column ${addSide === "left" ? "before" : "after"} “${label}”`}
        onCancel={() => setAddSide(null)}
        onSubmit={async (column) => {
          await onAddColumn?.(column, addSide ?? "right");
          setAddSide(null);
          onClose();
        }}
      />

      {/* THE WARNING. Bridge's own Dialog, never the browser's `confirm` — a
          native dialog cannot state a consequence, cannot show the dependency
          preview, and is a counted violation in `check:ui-rules`. */}
      <Dialog open={Boolean(pending)} onOpenChange={(next) => !next && setPending(null)}>
        <DialogContent onPointerDown={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.consequence}</DialogDescription>
          </DialogHeader>
          {pending?.detail}
          {pending?.input?.kind === "text" && (
            <Input
              autoFocus
              value={draft}
              aria-label={pending.title}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          {pending?.input?.kind === "columnType" && (
            <Select value={draft} onValueChange={setDraft}>
              <SelectTrigger aria-label="Column type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_TYPES.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {pending?.input?.kind === "columnType" && (
            // A retype to a choice kind used to produce a chooser over nothing.
            // SAME editor the Add column dialog uses (TASK-112).
            <ColumnOptionsEditor
              kind={draft as ColumnTypeName}
              options={options}
              onChange={setOptions}
            />
          )}
          {failure && (
            <p role="alert" className="text-xs" style={{ color: "var(--color-danger)" }}>
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(busyReason)}
              title={busyReason}
              onClick={async () => {
                if (!pending) return;
                setBusy(true);
                setFailure(null);
                try {
                  if (pending.runWithOptions) await pending.runWithOptions(draft, options);
                  else await pending.run(draft);
                  setPending(null);
                  onClose();
                } catch (error) {
                  // The server has the last word. Its refusal is shown here
                  // rather than swallowed into a dialog that closes as if the
                  // command had worked.
                  setFailure(error instanceof Error ? error.message : String(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {pending?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The DOM header's trigger + panel.
 *
 * THE COLUMN NAME IS THE TRIGGER (user report 2026-09-05: "I dont want to see 3
 * dots next to every column name, the those options should appear alongside
 * other options upon right click of column name"). The resident ⋮ is gone; the
 * gesture is right-click, the SAME gesture and the SAME positioned panel the
 * row body's cell menu uses.
 *
 * A gesture is not a keyboard route, so the header stays a real control: it is
 * focusable, announces itself as a menu button, and Enter / Space / the
 * context-menu key open the identical panel anchored under the header. Removing
 * the button removed a click target, never the accessibility.
 */
export function StandardColumnMenu(props: StandardColumnMenuItemProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const close = useCallback(() => setPosition(null), []);

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-label={`${props.label} column actions`}
        title={props.description ?? "Right-click for column actions"}
        className="cursor-context-menu rounded outline-none focus-visible:ring-1 focus-visible:ring-current"
        onContextMenu={(event) => {
          event.preventDefault();
          setPosition(clampMenuPosition({ x: event.clientX, y: event.clientY }));
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " " && event.key !== "ContextMenu") return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition(clampMenuPosition({ x: rect.left, y: rect.bottom + 4 }));
        }}
      >
        {props.label}
      </span>
      {position && <StandardColumnMenuPanel {...props} position={position} onClose={close} />}
    </>
  );
}
