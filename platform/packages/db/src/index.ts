/**
 * @bridge/db — Drizzle schema (mirror of docs/raw/SCHEMA.sql), client factory,
 * and core port bindings (the Drizzle-backed LedgerStore).
 */
export * as schema from "./schema.js";
export { createDb, type Database, type DbConfig } from "./client.js";
export {
  createLocalDb,
  LocalDbInitializationCleanupError,
  type LocalDatabase,
  type LocalDbConfig,
} from "./client-local.js";
export { assertRlsPosture, type RlsEnvironment, type RlsPostureOptions, type RlsRoleAttributes } from "./rls-guard.js";
export { DrizzleLedgerStore } from "./ledger-store.js";
export {
  DrizzleRelationMaterializationStore,
  type EnsureRelationMaterializationInput,
  type RelationMaterializationAttempt,
  type RelationMaterializationCursor,
  type RelationMaterializationEffect,
  type RelationMaterializationPage,
  type RelationMaterializationStatus,
} from "./relation-materialization-store.js";
export {
  DrizzleRoleStore,
  DrizzleAgentStore,
  DrizzleEphemeralStore,
  DrizzlePolicyStore,
  ensureInternalStrategistGovernance,
  ensureGovernanceAgentGovernance,
  ensureCapabilityBuilderGovernance,
  ensureRelationshipUserGovernance,
  ensureLearningAgentGovernance,
  ensureOutreachAgentGovernance,
  ensureEgressAgentGovernance,
  ensureIntakeAgentGovernance,
  ensureDealPilotPrincipalGovernance,
  type InternalStrategistGovernanceConfig,
  type RelationshipUserGovernanceConfig,
  type FoundationalAgentGovernanceConfig,
  type LearningAgentGovernanceConfig,
  type OutreachAgentGovernanceConfig,
  type PrincipalGovernanceConfig,
} from "./governance-stores.js";
export {
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
  parseAutomationSteps,
} from "./automation-stores.js";
export {
  DrizzleCanonicalIdentityStore,
  InMemoryCanonicalIdentityStore,
  type CanonicalIdentityStore,
  type CanonicalPersonIdentity,
  type UpsertResult,
} from "./canonical-store.js";
export {
  DrizzleIntegrationStore,
  IntegrationFloorScopeError,
  ALWAYS_APPROVAL_SCOPES,
  INTEGRATION_ACTOR_TYPE,
  type IntegrationRow,
  type ScopeGrant,
} from "./integration-store.js";
export { PgliteMediaStore, createLocalMediaStore } from "./media-store.js";
export {
  DrizzleWorkspaceStore,
  UnknownWorkspaceError,
  WorkspaceRenameCoordinatorUnavailableError,
  WorkspaceRenameRollbackError,
  type WorkspaceRenameCoordinator,
  type WorkspaceRenameLease,
  type WorkspaceRow,
  type MemberRow,
} from "./workspace-store.js";
export {
  DrizzleGraphStore,
  type ArchiveRelationshipRecordInput,
  type CommitmentPage,
  type CommitmentRecord,
  type CommitmentStatus,
  type CommunityDetail,
  type CommunityRecord,
  type CreateCommunityInput,
  type CreateInteractionInput,
  type CreatePersonInput,
  type DecisionProvenance,
  type FullGraphEdgeRecord,
  type FullGraphNodeRecord,
  type FullGraphPage,
  type GraphRelationPage,
  type InteractionParticipantInput,
  type IntroductionPage,
  type IntroductionRecord,
  type IntroductionStatus,
  type MaterializeIntroductionInput,
  type MaterializeSignalEvidenceInput,
  type MaterializeCommitmentInput,
  type NodeTypeOwner,
  type PageOpts,
  type Page,
  type PersonRecord,
  type PersonDetail,
  type RelationCursor,
  type RelationPage,
  type RelationshipPath,
  type RelationshipPathNode,
  type RelationshipPathResult,
  type RelationshipPathStep,
  type RelationRecord,
  type RelationVisibility,
  type SignalDetail,
  type SignalEvidenceAnchor,
  type SignalParticipant,
  type SignalParticipantRelationInput,
  type TimelineCursor,
  type TimelineItem,
  type TimelinePage,
  type TimelineParticipant,
  type UpdateCommunityInput,
  type UpdatePersonInput,
  type UpsertRelationInput,
} from "./graph-store.js";
export { DrizzleJobPilotStore, type JobRow, type ApplicationRow, type CreateJobInput } from "./jobpilot-store.js";
export {
  DrizzleHelpdeskStore,
  type TicketRow,
  type InternalTicketRow,
  type MessageRow,
  type HelpdeskPage,
} from "./helpdesk-store.js";
export { DrizzleResourcesStore, type ResourceRow, type CreateResourceInput as CreateResourceStoreInput } from "./resources-store.js";
export {
  DrizzleCapabilityStore,
  parseDependencies,
  parseEvidence,
} from "./capability-store.js";
export {
  DrizzleWorkspaceDefinitionStore,
  parseBlueprint,
} from "./workspace-definition-store.js";
export { DrizzlePackageStore, parsePackageManifestRow } from "./package-store.js";
export { DrizzleMemoryStore } from "./memory-store.js";
export { DrizzleGoalTaskStore } from "./goal-task-store.js";
export { DrizzleSkillManifestRegistry, seedSkillManifests } from "./skill-manifest-store.js";
export { DrizzleChildAgentRunStore } from "./child-agent-run-store.js";

import type { Database as Db } from "./client.js";
import { DrizzleLedgerStore } from "./ledger-store.js";
import { DrizzleRelationMaterializationStore } from "./relation-materialization-store.js";
import {
  DrizzleAgentStore,
  DrizzleEphemeralStore,
  DrizzlePolicyStore,
  DrizzleRoleStore,
} from "./governance-stores.js";
import {
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
} from "./automation-stores.js";
import {
  DrizzleWorkspaceStore,
  type WorkspaceRenameCoordinator,
} from "./workspace-store.js";

/** All Drizzle-backed ports, ready to hand to the core pipeline + executor. */
export function createDrizzlePorts(
  db: Db,
  options: {
    defaultWorkspaceId?: string;
    workspaceRenameCoordinator?: WorkspaceRenameCoordinator;
  } = {},
) {
  return {
    roles: new DrizzleRoleStore(db),
    agents: new DrizzleAgentStore(db),
    ephemeral: new DrizzleEphemeralStore(db),
    policies: new DrizzlePolicyStore(db),
    ledger: new DrizzleLedgerStore(db, options),
    relationMaterializations: new DrizzleRelationMaterializationStore(db),
    automationRegistry: new DrizzleAutomationRegistry(db),
    automationRunRecorder: new DrizzleAutomationRunRecorder(db),
    workspaceStore: new DrizzleWorkspaceStore(db, options.workspaceRenameCoordinator),
  };
}
