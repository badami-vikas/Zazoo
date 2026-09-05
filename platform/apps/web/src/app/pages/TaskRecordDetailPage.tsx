import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, GitBranch, Link2, ShieldCheck, UserCog } from "lucide-react";
import { Link, useParams } from "react-router";
import { RecordSections } from "../components/shared/RecordSections";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { PlanningProposalReview } from "../components/shared/PlanningProposalReview";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type Task = Awaited<ReturnType<typeof trpc.taskManager.get.query>>;
type Proposal = Awaited<ReturnType<typeof trpc.taskManager.proposeRestructure.mutate>>;
type PlanningRun = Awaited<ReturnType<typeof trpc.taskManager.runPlanningPlaybook.mutate>>;
type Assignment = Awaited<ReturnType<typeof trpc.taskManager.assign.mutate>>;
type Dependency = Awaited<ReturnType<typeof trpc.taskManager.dependencies.query>>["dependencies"][number];

const PLAYBOOK_SKILLS = [
  "task-decomposition",
  "goal-outcome-framing",
  "candidate-task-generation",
  "exit-test-authoring",
  "premortem-scenario",
] as const;

/** Proposals expire; the API requires a bound and refuses a decision past it. */
function expiry(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString();
}

/** Idempotency keys are the server's replay protection, so they have to be
 * stable per intent rather than per click — the same Playbook run on the same
 * Task resolves to the same Run instead of a second one. */
function idempotencyKey(...parts: string[]): string {
  return parts.join(":").slice(0, 200);
}

export function TaskRecordDetailPage() {
  const { taskId = "" } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [ancestorTitle, setAncestorTitle] = useState("");
  const [planning, setPlanning] = useState<PlanningRun | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [blockerTaskId, setBlockerTaskId] = useState("");
  const [blockerReason, setBlockerReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [record, graph] = await Promise.all([
        trpc.taskManager.get.query({ organizationId: PILOT_ORGANIZATION, taskId }),
        trpc.taskManager.dependencies.query({ organizationId: PILOT_ORGANIZATION }),
      ]);
      setTask(record);
      setDependencies(graph.dependencies.filter((edge) => edge.taskId === taskId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  async function propose(operation: Parameters<typeof trpc.taskManager.proposeRestructure.mutate>[0]["operation"]) {
    try {
      setProposal(await trpc.taskManager.proposeRestructure.mutate({
        organizationId: PILOT_ORGANIZATION,
        operation,
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function decide(decision: "approve" | "veto") {
    if (!proposal) return;
    try {
      await trpc.taskManager.decideProposal.mutate({
        organizationId: PILOT_ORGANIZATION,
        proposalId: proposal.id,
        decision,
      });
      setProposal(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function verifyAndComplete() {
    const reference = evidenceRef.trim();
    if (!reference) {
      setError("Evidence reference is required before completion.");
      return;
    }
    try {
      await trpc.taskManager.verify.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId,
        evidenceRefs: [reference],
      });
      await trpc.taskManager.transition.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId,
        status: "done",
      });
      setEvidenceRef("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function changeTarget() {
    const outcome = task?.outcomes[0];
    if (!outcome || !newTarget.trim()) return;
    try {
      const result = await trpc.taskManager.updateOutcomeTarget.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId,
        outcomeId: outcome.id,
        target: newTarget.trim(),
      });
      if (result.reopenProposal) setProposal(result.reopenProposal);
      setNewTarget("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** Every governed call on this Page runs through here so a refusal reaches
   * the reviewer as a sentence instead of an unhandled rejection. A cycle,
   * a stale version and an expired proposal are all answers, not crashes. */
  async function governed(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function runPlaybook(skill: (typeof PLAYBOOK_SKILLS)[number]) {
    return governed(async () => {
      setPlanning(await trpc.taskManager.runPlanningPlaybook.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId,
        skill,
        idempotencyKey: idempotencyKey("playbook", taskId, skill),
        expiresAt: expiry(),
      }));
    });
  }

  function decidePlanning(
    decision: "approve" | "edit" | "veto",
    editedPlanningItems?: Array<Record<string, unknown>>,
  ) {
    return governed(async () => {
      if (!planning?.candidateProposal) return;
      await trpc.taskManager.decideProposal.mutate({
        organizationId: PILOT_ORGANIZATION,
        proposalId: planning.candidateProposal.id,
        decision,
        ...(editedPlanningItems ? { editedPlanningItems } : {}),
      });
      setPlanning(null);
      await load();
    });
  }

  function assign() {
    return governed(async () => {
      setAssignment(await trpc.taskManager.assign.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId,
        idempotencyKey: idempotencyKey("assign", taskId),
        expiresAt: expiry(),
      }));
      await load();
    });
  }

  function decideAssignment(decision: "approve" | "veto") {
    return governed(async () => {
      if (!assignment?.routeProposal) return;
      await trpc.taskManager.decideProposal.mutate({
        organizationId: PILOT_ORGANIZATION,
        proposalId: assignment.routeProposal.id,
        decision,
      });
      setAssignment(null);
      await load();
    });
  }

  function addDependency() {
    return governed(async () => {
      await trpc.taskManager.addDependency.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId,
        dependsOnTaskId: blockerTaskId.trim(),
        ...(blockerReason.trim() ? { reason: blockerReason.trim() } : {}),
      });
      setBlockerTaskId("");
      setBlockerReason("");
      await load();
    });
  }

  function removeDependency(dependencyId: string) {
    return governed(async () => {
      await trpc.taskManager.removeDependency.mutate({
        organizationId: PILOT_ORGANIZATION,
        dependencyId,
      });
      await load();
    });
  }

  // An Automation's anchor Task is a kernel Task with no Task Manager Record
  // behind it. Its approvals still belong here (ADR 2026-09-04), so the page
  // renders that section with the Record's absence stated, not a dead end.
  if (error && !task) {
    return (
      <div className="h-full overflow-auto bg-white">
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
          <Link to="/task-manager" className="inline-flex items-center gap-1 text-sm text-[var(--color-steel)]">
            <ArrowLeft className="size-4" /> Queue
          </Link>
          <p role="alert" className="text-sm text-muted-foreground">{error}</p>
          <TaskApprovalsSection taskId={taskId} />
        </div>
      </div>
    );
  }
  if (!task) return <p role="status" className="p-6 text-sm text-muted-foreground">Loading Task Record…</p>;

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <Link to="/task-manager" className="inline-flex items-center gap-1 text-sm text-[var(--color-steel)]">
          <ArrowLeft className="size-4" /> Queue
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Task {task.path}</p>
            <h1 className="break-words text-2xl font-semibold text-[var(--color-navy)]">{task.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border px-2.5 py-1">{task.status.split("_").join(" ")}</span>
            <span className="rounded-full border px-2.5 py-1">{task.priority}</span>
            {task.isGoal && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">Goal-flagged</span>}
          </div>
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Outcomes</h2>
            {task.outcomes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outcomes recorded.</p>
            ) : task.outcomes.map((outcome) => (
              <div key={outcome.id} className="space-y-1 text-sm">
                <p className="font-medium">{outcome.title}</p>
                <p className="text-muted-foreground">{outcome.measure}: {outcome.current ?? "not measured"} → {outcome.target}</p>
              </div>
            ))}
            {task.outcomes[0] && (
              <div className="mt-3 flex min-w-0 gap-2">
                <input value={newTarget} onChange={(event) => setNewTarget(event.target.value)} placeholder="Changed target" className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm" />
                <button type="button" onClick={() => void changeTarget()} className="rounded-md border px-3 py-2 text-sm">Update</button>
              </div>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Exit test and evidence</h2>
            <p className="text-sm">{task.exitTest ?? (task.isGoal ? `Review cadence: ${task.reviewCadence ?? "not set"}` : "No exit test recorded.")}</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {task.evidenceRefs.map((reference) => <li key={reference} className="break-all">{reference}</li>)}
            </ul>
            <div className="mt-3 flex min-w-0 gap-2">
              <input value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="Event, Result, File, or Record reference" className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm" />
              <button type="button" onClick={() => void verifyAndComplete()} className="inline-flex items-center gap-1 rounded-md bg-[var(--color-steel)] px-3 py-2 text-sm text-white">
                <CheckCircle2 className="size-4" /> Verify done
              </button>
            </div>
          </div>
        </section>

        <TaskApprovalsSection taskId={taskId} />

        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <GitBranch className="size-4 text-[var(--color-steel)]" />
            <h2 className="text-sm font-semibold">Governed tree restructure</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => void propose({ kind: "promote", taskId })} className="rounded-md border px-3 py-2 text-sm">Promote to root</button>
            <div className="flex min-w-0 gap-2">
              <input value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)} placeholder="New parent Record ID" className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm" />
              <button type="button" disabled={!parentTaskId} onClick={() => void propose({ kind: "re_parent", taskId, parentTaskId })} className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Move</button>
            </div>
            <div className="flex min-w-0 gap-2">
              <input value={ancestorTitle} onChange={(event) => setAncestorTitle(event.target.value)} placeholder="Ancestor title" className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm" />
              <button type="button" disabled={!ancestorTitle.trim()} onClick={() => void propose({
                kind: "insert_ancestor_above",
                taskId,
                ancestor: { title: ancestorTitle.trim(), ownerType: "human", ownerId: task.ownerId },
              })} className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Insert</button>
            </div>
          </div>
          {proposal && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" /> Pending Human review: {proposal.kind.split("_").join(" ")}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void decide("approve")} className="rounded-md bg-[var(--color-navy)] px-3 py-1.5 text-white">Approve</button>
                <button type="button" onClick={() => void decide("veto")} className="rounded-md border px-3 py-1.5">Veto</button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-[var(--color-steel)]" />
            <h2 className="text-sm font-semibold">Planning Playbooks</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Internal Strategist drafts; nothing reaches the queue until you decide. You may correct a draft
            before approving it.
          </p>
          <div className="flex flex-wrap gap-2">
            {PLAYBOOK_SKILLS.map((skill) => (
              <button
                key={skill}
                type="button"
                disabled={busy}
                onClick={() => void runPlaybook(skill)}
                className="rounded-md border px-3 py-2 text-sm disabled:opacity-40"
              >
                {skill.split("-").join(" ")}
              </button>
            ))}
          </div>
          {planning && (
            <div className="mt-4">
              <PlanningProposalReview
                payload={planning.candidateProposal?.payload}
                busy={busy}
                onDecide={decidePlanning}
              />
            </div>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <UserCog className="size-4 text-[var(--color-steel)]" />
            <h2 className="text-sm font-semibold">Agent assignment</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Chief of Staff resolves whichever Agent owns this Task&apos;s required Skill. There is no default:
            an ambiguous or unmatched Task stays Human work.
          </p>
          <button
            type="button"
            disabled={busy || !task.requiredSkillId}
            title={task.requiredSkillId ? undefined : "This Task names no required Skill, so there is nothing to route on."}
            onClick={() => void assign()}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-40"
          >
            Route to an eligible Agent
          </button>
          {assignment && assignment.routing.kind !== "assigned" && (
            <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Human assignment required: {assignment.routing.reason}. Nothing was staged to approve —
              no Agent was found eligible, so there is no assignment to accept.
            </p>
          )}
          {assignment?.routeProposal && assignment.routeProposal.status === "pending_review" && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm">
              <p className="font-medium">
                Assign to Agent {(assignment.routing as { agentId: string }).agentId}?
              </p>
              <p className="mt-1 text-xs text-amber-900">
                Governance banded this {String(assignment.gate?.band)} and returned
                {" "}{String(assignment.gate?.decision).split("_").join(" ")} on{" "}
                {assignment.gate?.calibration.approvals} prior approval(s) and{" "}
                {assignment.gate?.calibration.vetoes} veto(es). Assigning grants authority to run this Task;
                it does not start it.
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void decideAssignment("approve")} className="rounded-md bg-[var(--color-navy)] px-3 py-1.5 text-white disabled:opacity-40">Approve assignment</button>
                <button type="button" disabled={busy} onClick={() => void decideAssignment("veto")} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Veto</button>
              </div>
            </div>
          )}
          {assignment?.assigned && (
            <p className="mt-3 text-sm text-muted-foreground">
              {String((assignment.assigned as { note?: unknown }).note ?? "Assigned.")}
            </p>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Link2 className="size-4 text-[var(--color-steel)]" />
            <h2 className="text-sm font-semibold">Depends on</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            One edge kind: &quot;blocked by&quot; is this same edge read from the other end. A blocker that is
            done or abandoned stops blocking, and a cycle is refused.
          </p>
          {dependencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">This Task waits on nothing.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {dependencies.map((edge) => (
                <li key={edge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span className="min-w-0 break-all">
                    {edge.dependsOnTaskId}
                    {edge.reason && <span className="text-muted-foreground"> — {edge.reason}</span>}
                  </span>
                  <button type="button" disabled={busy} onClick={() => void removeDependency(edge.id)} className="rounded-md border px-2 py-1 text-xs disabled:opacity-40">Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input value={blockerTaskId} onChange={(event) => setBlockerTaskId(event.target.value)} placeholder="Blocking Task Record ID" className="min-w-0 rounded-md border px-3 py-2 text-sm" />
            <input value={blockerReason} onChange={(event) => setBlockerReason(event.target.value)} placeholder="Why (optional)" className="min-w-0 rounded-md border px-3 py-2 text-sm" />
            <button type="button" disabled={busy || !blockerTaskId.trim()} onClick={() => void addDependency()} className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Add blocker</button>
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-semibold">Relations and activity</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Parent</dt><dd className="break-all">{task.parentTaskId ?? "Root"}</dd></div>
            <div><dt className="text-muted-foreground">Required Skill</dt><dd>{task.requiredSkillId ?? "Human assignment"}</dd></div>
            <div><dt className="text-muted-foreground">Owner</dt><dd className="break-all">{task.ownerId}</dd></div>
            <div><dt className="text-muted-foreground">Version</dt><dd>{task.version}</dd></div>
          </dl>
        </section>
        <ModuleFilesSection moduleName="task-manager" />
        {/* The Sections this Database's Record pages show, chosen once for the
            whole Database from the Tasks toolbar's ⋮ → Records (TASK-083). */}
        <RecordSections specId="task-manager.tasks" moduleName="task-manager" recordId={taskId} />
      </div>
    </div>
  );
}

type PendingForTask = Awaited<ReturnType<typeof trpc.action.listPendingForTask.query>>["items"][number];

/**
 * Approvals belong to Tasks (ADR 2026-09-04): every undecided proposal an
 * Automation Run raised under this Task, decided right here. The section is
 * present with nothing in it when nothing waits — the same surface, empty.
 *
 * `taskId: null` is the queue's own copy: proposals with no Task behind them
 * (a direct Human action has no Automation Run). Those render at the top of
 * the Task Manager index and only when something waits, so the queue is not
 * headed by an empty box every morning.
 */
export function TaskApprovalsSection({ taskId }: { taskId: string | null }) {
  const [items, setItems] = useState<PendingForTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  async function load() {
    try {
      const result = await trpc.action.listPendingForTask.query({ organizationId: PILOT_ORGANIZATION, taskId });
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void load();
  }, [taskId]);

  async function decide(proposalId: string, decision: "approve" | "veto") {
    setDeciding(proposalId);
    try {
      await trpc.action.decide.mutate({ proposalId, decision });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeciding(null);
    }
  }

  if (taskId === null && !error && (items?.length ?? 0) === 0) return null;

  return (
    <section id="approvals" className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="size-4 text-[var(--color-steel)]" />
        <h2 className="text-sm font-semibold">{taskId === null ? "Waiting for your yes" : "Approvals"}</h2>
        {items && items.length > 0 && (
          <span className="text-xs text-muted-foreground">{items.length} waiting on you</span>
        )}
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-red-700">{error}</p>}
      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waits on this Task.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{item.copy.title}</p>
                <p className="text-xs text-muted-foreground">{item.copy.detail}</p>
                <p className="text-xs text-muted-foreground">
                  Proposed {new Date(item.createdAt).toLocaleString()} by {item.request.actor.type} {item.request.actor.id.slice(-4)}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={deciding === item.id} onClick={() => void decide(item.id, "approve")} className="rounded-md border px-3 py-1.5 text-xs font-semibold">Approve</button>
                <button type="button" disabled={deciding === item.id} onClick={() => void decide(item.id, "veto")} className="rounded-md border px-3 py-1.5 text-xs">Veto</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
