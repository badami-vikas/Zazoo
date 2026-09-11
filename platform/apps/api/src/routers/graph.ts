import { z } from "zod";
import { taskIsOpen } from "@bridge/core";
import { t, procedure, paginatedInput } from "../router-shared.js";

/** Cross-Module graph and generic Record reads. */
export const graphRouter = t.router({
  full: procedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ input, ctx }) => {
      const loadModuleInstallations = async () => {
        const items = [];
        let offset = 0;
        let total = 0;
        do {
          const page = await ctx.wiring.moduleStore.list(
            input.organizationId,
            { limit: 100, offset },
          );
          total = page.total;
          if (page.items.length === 0 && offset < total) {
            throw new Error("Module installation pagination stopped before reaching the reported total");
          }
          items.push(...page.items);
          offset += page.items.length;
        } while (offset < total);
        return items;
      };
      const [graph, moduleInstallations, taskQueue, taskDependencyEdges] = await Promise.all([
        ctx.wiring.graphStore.listFullGraph(
          input.organizationId,
          ctx.identity.id,
          { limit: input.limit },
        ),
        loadModuleInstallations(),
        // TM5 (ADR-205) — Tasks live in their own Database, not in the graph
        // store's Records, so Second Brain never showed them. Second Brain
        // IS Graph view at full scope (ADR-110), and "full" that silently
        // omits the execution queue is not full.
        ctx.wiring.taskManager.list(input.organizationId),
        ctx.wiring.taskManager.listDependencies(input.organizationId),
      ]);
      const installations = moduleInstallations.filter(
        (installation) =>
          installation.state === "available" &&
          installation.status === "installed" &&
          installation.manifest.module !== undefined &&
          installation.moduleAttachment === undefined,
      );
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
      for (const installation of installations) {
        const module = installation.manifest.module!;
        nodes.set(`module:${installation.moduleName}`, {
          id: `module:${installation.moduleName}`,
          recordId: installation.moduleName,
          recordType: "module",
          label:
            module.displayName ??
            installation.manifest.name ??
            installation.moduleName,
          databaseId: "modules",
          databaseLabel: "Modules",
          moduleId: installation.moduleName,
          subtitle: `Module v${installation.moduleVersion}`,
          recordPath: `/module/${installation.moduleName}`,
          provenance: `Module installation · source ${installation.moduleName}`,
        });
        for (const agent of module.agents) {
          const recordId = `${installation.moduleName}:${agent.id}`;
          nodes.set(`agent:${recordId}`, {
            id: `agent:${recordId}`,
            recordId,
            recordType: "agent",
            label: agent.name,
            databaseId: "agents",
            databaseLabel: "Agents",
            moduleId: installation.moduleName,
            subtitle: `${agent.skillIds.length} ${agent.skillIds.length === 1 ? "Skill" : "Skills"}`,
            recordPath: `/module/${installation.moduleName}#agent-${agent.id}`,
            provenance: `Agent binding · source ${installation.moduleName}`,
          });
        }
      }
      // Task nodes, capped by the SAME limit the rest of the graph honours:
      // a queue is the one Database that reliably outgrows every other, and
      // letting it alone ignore the cap would make a large queue crowd out
      // everything Second Brain exists to relate it to. Closed work is
      // dropped first — an archived Task is history, not context.
      const graphTasks = [...taskQueue]
        .sort((a, b) => Number(taskIsOpen(b.status)) - Number(taskIsOpen(a.status)))
        .slice(0, input.limit);
      for (const task of graphTasks) {
        nodes.set(`task:${task.id}`, {
          id: `task:${task.id}`,
          recordId: task.id,
          recordType: "task",
          label: `${task.path} — ${task.title}`,
          databaseId: "task-manager.tasks",
          databaseLabel: "Tasks",
          moduleId: "task-manager",
          subtitle: task.isGoal ? `Goal · ${task.status}` : task.status,
          recordPath: `/task-manager/${task.id}`,
          provenance: `Task Manager queue · ${task.path}`,
        });
      }
      // K3 (TASK-047) — the knowledge region: entities + live claims, the
      // Second Brain projection of the SAME rows the fusion graph lane
      // retrieves. Flight-gated and owner-scoped to the viewer; a "full"
      // graph that hid accepted knowledge would break the one-substrate
      // trust property ("what you see is what the model retrieves").
      const claimEdges: Array<{ sourceId: string; targetId: string; label: string; relationType: string; evidence: string }> = [];
      if (ctx.wiring.claimSubstrateEnabled) {
        const [claimEntities, claimRows] = await Promise.all([
          ctx.wiring.claimStore.listEntities(input.organizationId, ctx.identity.id),
          ctx.wiring.claimStore.liveClaims(input.organizationId, ctx.identity.id),
        ]);
        const claimsByEntity = new Map<string, number>();
        for (const claim of claimRows) {
          claimsByEntity.set(claim.entityId, (claimsByEntity.get(claim.entityId) ?? 0) + 1);
        }
        for (const entity of claimEntities.slice(0, input.limit)) {
          const nodeId = `claim-entity:${entity.id}`;
          const liveCount = claimsByEntity.get(entity.id) ?? 0;
          nodes.set(nodeId, {
            id: nodeId,
            recordId: entity.id,
            recordType: "claim_entity",
            label: entity.name,
            databaseId: "claims.entities",
            databaseLabel: "Claims",
            moduleId: "learning",
            subtitle: `${entity.kind} · ${liveCount} ${liveCount === 1 ? "claim" : "claims"}`,
            provenance: "Claim substrate · governed, Human-accepted",
          });
          // The entity is ABOUT an existing region row — link the regions
          // rather than copying them (the relationship graph becomes one
          // region of the whole, ADR-210).
          const regionNodeId = entity.refRecordId ? `${entity.kind}:${entity.refRecordId}` : null;
          if (regionNodeId && nodes.has(regionNodeId)) {
            claimEdges.push({
              sourceId: nodeId,
              targetId: regionNodeId,
              label: "about",
              relationType: "claim_about",
              evidence: `Claim entity ${entity.name}`,
            });
          }
        }
        for (const claim of claimRows.slice(0, input.limit)) {
          const entityNodeId = `claim-entity:${claim.entityId}`;
          if (!nodes.has(entityNodeId)) continue;
          const nodeId = `claim:${claim.id}`;
          nodes.set(nodeId, {
            id: nodeId,
            recordId: claim.id,
            recordType: "claim",
            label: `${claim.field}: ${claim.value}`,
            databaseId: "claims.rows",
            databaseLabel: "Claims",
            moduleId: "learning",
            subtitle: `${claim.claimClass} · ${claim.sensitivity}`,
            provenance: `Accepted ${new Date(claim.recordedAt).toISOString().slice(0, 10)} · ${claim.evidence.length} evidence ref${claim.evidence.length === 1 ? "" : "s"} · decision ${claim.decisionRef.slice(0, 8)}`,
          });
          claimEdges.push({
            sourceId: nodeId,
            targetId: entityNodeId,
            label: "claim of",
            relationType: "claim_of",
            evidence: `Governed claim · decision ${claim.decisionRef.slice(0, 8)}`,
          });
        }
      }
      for (const [id, node] of nodes) {
        if (node.recordPath || !nodes.has(`module:${node.moduleId}`)) continue;
        nodes.set(id, { ...node, recordPath: `/module/${node.moduleId}` });
      }
      const edges = new Map(graph.edges.map((edge) => {
        const source = nodes.get(edge.sourceId);
        const target = nodes.get(edge.targetId);
        return [edge.id, {
          ...edge,
          ...(source?.recordPath || target?.recordPath
            ? { recordPath: source?.recordPath ?? target?.recordPath }
            : {}),
        }];
      }));
      // Both Task edge kinds, and they are genuinely different questions:
      // the tree says where work SITS, the dependency says what it WAITS ON.
      // Collapsing them into one edge type would make Second Brain unable to
      // answer either.
      const includedTaskIds = new Set(graphTasks.map((task) => task.id));
      for (const task of graphTasks) {
        if (!task.parentTaskId || !includedTaskIds.has(task.parentTaskId)) continue;
        const id = `task-parent:${task.id}`;
        edges.set(id, {
          id,
          sourceId: `task:${task.id}`,
          targetId: `task:${task.parentTaskId}`,
          label: "subtask of",
          relationType: "task_parent",
          sourceModule: "task-manager",
          evidence: `Task tree · ${task.path}`,
          recordPath: `/task-manager/${task.id}`,
        });
      }
      for (const dependency of taskDependencyEdges) {
        if (!includedTaskIds.has(dependency.taskId) || !includedTaskIds.has(dependency.dependsOnTaskId)) continue;
        const id = `task-depends-on:${dependency.id}`;
        edges.set(id, {
          id,
          sourceId: `task:${dependency.taskId}`,
          targetId: `task:${dependency.dependsOnTaskId}`,
          label: "depends on",
          relationType: "task_depends_on",
          sourceModule: "task-manager",
          evidence: dependency.reason ?? "Task dependency Relation",
          recordPath: `/task-manager/${dependency.taskId}`,
        });
      }
      for (const claimEdge of claimEdges) {
        const id = `${claimEdge.relationType}:${claimEdge.sourceId}:${claimEdge.targetId}`;
        edges.set(id, {
          id,
          sourceId: claimEdge.sourceId,
          targetId: claimEdge.targetId,
          label: claimEdge.label,
          relationType: claimEdge.relationType,
          sourceModule: "learning",
          evidence: claimEdge.evidence,
        });
      }
      for (const node of nodes.values()) {
        if (node.recordType === "module") continue;
        const moduleNodeId = `module:${node.moduleId}`;
        if (!nodes.has(moduleNodeId)) continue;
        const id = `source-module:${node.id}:${moduleNodeId}`;
        edges.set(id, {
          id,
          sourceId: node.id,
          targetId: moduleNodeId,
          label: "from",
          relationType: "originates_from",
          sourceModule: node.moduleId,
          evidence: `Source Module ${node.moduleId}`,
          recordPath: nodes.get(moduleNodeId)?.recordPath,
        });
      }
      const composedNodes = [...nodes.values()];
      const databases = new Map(graph.databases.map((database) => [database.id, database]));
      if (composedNodes.some((node) => node.recordType === "module")) {
        databases.set("modules", { id: "modules", label: "Modules", moduleId: "modules" });
      }
      if (composedNodes.some((node) => node.recordType === "agent")) {
        databases.set("agents", { id: "agents", label: "Agents", moduleId: "agents" });
      }
      if (composedNodes.some((node) => node.recordType === "task")) {
        databases.set("task-manager.tasks", {
          id: "task-manager.tasks",
          label: "Tasks",
          moduleId: "task-manager",
        });
      }
      if (composedNodes.some((node) => node.recordType === "claim_entity" || node.recordType === "claim")) {
        databases.set("claims.entities", { id: "claims.entities", label: "Claims", moduleId: "learning" });
        databases.set("claims.rows", { id: "claims.rows", label: "Claims", moduleId: "learning" });
      }
      return {
        nodes: composedNodes,
        edges: [...edges.values()],
        databases: [...databases.values()],
        hasMore: graph.hasMore || graphTasks.length < taskQueue.length,
      };
    }),

  listRecords: procedure
    .input(paginatedInput)
    .query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.graphStore.listRecords(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  getRecord: procedure.input(z.object({ id: z.string().uuid() })).query(async ({ input, ctx }) => {
    return ctx.wiring.graphStore.getRecord(input.id);
  }),

});
