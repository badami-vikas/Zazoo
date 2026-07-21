import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, GitBranch, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type Task = Awaited<ReturnType<typeof trpc.taskManager.get.query>>;
type Proposal = Awaited<ReturnType<typeof trpc.taskManager.proposeRestructure.mutate>>;

export function TaskRecordDetailPage() {
  const { taskId = "" } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [ancestorTitle, setAncestorTitle] = useState("");

  async function load() {
    try {
      setTask(await trpc.taskManager.get.query({ organizationId: PILOT_ORGANIZATION, taskId }));
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

  if (error && !task) return <p role="alert" className="p-6 text-sm text-red-600">{error}</p>;
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
          <h2 className="mb-3 text-sm font-semibold">Relations and activity</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Parent</dt><dd className="break-all">{task.parentTaskId ?? "Root"}</dd></div>
            <div><dt className="text-muted-foreground">Required Skill</dt><dd>{task.requiredSkillId ?? "Human assignment"}</dd></div>
            <div><dt className="text-muted-foreground">Owner</dt><dd className="break-all">{task.ownerId}</dd></div>
            <div><dt className="text-muted-foreground">Version</dt><dd>{task.version}</dd></div>
          </dl>
        </section>
        <ModuleFilesSection moduleName="task-manager" />
      </div>
    </div>
  );
}
