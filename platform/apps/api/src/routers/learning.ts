import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { parseAutomationSteps } from "@bridge/db";
import { relationshipMutationPayloadSchema } from "../relationship-record-materializer.js";
import { relationshipDateTimeSchema } from "../relationship-datetime.js";
import { CAPABILITY_BUILDER_AGENT, LEARNING_AGENT, ledgerSignalId, appFocusCaptureSignalId, browserCaptureSignalId, inputCaptureSignalId } from "../wiring.js";
import { hashTaintValue, labelAtSource } from "@bridge/core";
import { acceptAutomationDraft, acceptSuggestion as acceptLearningSuggestion, detectAutomationDraftCandidates, digestSignals as digestLearningSignals, generalizeLearnedPreferences, listPromotionSuggestions, ClaimGateError, recordRejectionFingerprint, classifyClaimContent, draftStepsFromEpisodes, draftStructureFromClaims, episodesForSkill, rejectAutomationDraft, seedSuggestionsFromArchetypes, supportBandRank, listSuggestions as listLearningSuggestions, listSignalModuleIds, mineLedgerSignals, rejectSuggestion as rejectLearningSuggestion, retrieveLearnedPreferences, CAPTURE_SOURCES, acceptCommitmentSuggestion, browserCaptureVerdict, browserVisitCaptureSignal, captureAllowed, normalizeBrowserDomain, listCommitmentSuggestions, readCaptureConsent, recordSignal as recordCaptureSignal, rejectCommitmentSuggestion, withCapturePaused, withSourceConsent, distilKeystrokeBurst, inputCaptureSignal, withInputCaptureDenylist, type CaptureConsentState, type FieldRole, acceptClaimSuggestion, CLAIM_ENTITY_KINDS, listClaimSuggestions, PROPOSABLE_CLAIM_CLASSES, proposeClaimSuggestion, readClaimSuggestion, rejectClaimSuggestion, TAINT_SENSITIVITY, type ClaimProposal } from "@bridge/core";
import { transition } from "@bridge/jobpilot";
import { deterministicUuid } from "../deterministic-uuid.js";
import { RETRIEVAL_EVAL_CAPABILITY_ID } from "../retrieval-eval.js";
import { CAPABILITY_BUILDER_AUTOMATION_ID, LEARNING_BROWSER_POLICY_NAMESPACE, LEARNING_CAPTURE_CONSENT_NAMESPACE, LEARNING_INPUT_DENYLIST_NAMESPACE, RETRIEVAL_EVAL_METRIC, RETRIEVAL_EVAL_METRIC_NOTE, assertArchetypesFlightEnabled, assertClaimFlightEnabled, assertHumanIdentity, assertLearningFlightEnabled, assertMembership, assertPilotOrganization, assertRetrievalFlightEnabled, isSuppressedByRejectionsAnyTier, learningActionError, organizationGuard, procedure, proposeRelationshipMutation, readBrowserPolicyState, readCaptureConsentState, readInputDenylistState, runAsCapabilityBuilder, t, withRejectionEmbedder, type BuilderStepsLaneResult } from "../router-shared.js";

/** TASK-032 — learning observation loop v1 behind the
 * `learningObservationEnabled` flight. Suggested-then-accepted is preserved
 * end to end: `digest` only proposes; only `suggestions.accept` (an explicit
 * Human mutation) mints a preference. All rows are the caller's private
 * Local-Plane Memories — authority scoping happens in the store. */
export const learningRouter = t.router({
  /** Always answerable (flight off included) so clients can honestly hide
   * the surface instead of rendering dead controls. */
  status: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return { enabled: ctx.wiring.learningObservationEnabled };
    }),

  /** K2 (TASK-046) — per-source capture consent. Bridge already HOLDS chat
   * threads and WhatsApp messages locally; emitting learning signals from
   * them is a NEW use, so it gets its own consent surface: default off,
   * per-source, with a kill switch that silences everything without
   * rewriting anyone's choices. Consent is a HUMAN decision — an agent or
   * team identity cannot flip these. */
  capture: t.router({
    /** Always answerable (flight off included), like `learning.status`,
     * so clients can honestly hide the toggles instead of rendering dead
     * controls. */
    status: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const state = await readCaptureConsentState(ctx.wiring, input.organizationId);
        return {
          enabled: ctx.wiring.learningObservationEnabled,
          paused: state.paused,
          pausedChangedAt: state.pausedChangedAt,
          pausedChangedBy: state.pausedChangedBy,
          sources: state.sources,
        };
      }),

    setSource: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          source: z.enum(CAPTURE_SOURCES),
          enabled: z.boolean(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Capture consent is a Human decision — only a user identity may change it",
          });
        }
        const changedBy = ctx.identity.id;
        const changedAt = new Date().toISOString();
        const state = await ctx.wiring.localPlane.state.update<CaptureConsentState>(
          input.organizationId,
          LEARNING_CAPTURE_CONSENT_NAMESPACE,
          null,
          (current) => {
            const next = withSourceConsent(
              readCaptureConsent(current),
              input.source,
              input.enabled,
              changedBy,
              changedAt,
            );
            return { state: next, result: next };
          },
        );
        return { paused: state.paused, sources: state.sources };
      }),

    setPaused: procedure
      .input(z.object({ organizationId: z.string().min(1), paused: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The capture kill switch is a Human decision — only a user identity may change it",
          });
        }
        const changedBy = ctx.identity.id;
        const changedAt = new Date().toISOString();
        const state = await ctx.wiring.localPlane.state.update<CaptureConsentState>(
          input.organizationId,
          LEARNING_CAPTURE_CONSENT_NAMESPACE,
          null,
          (current) => {
            const next = withCapturePaused(readCaptureConsent(current), input.paused, changedBy, changedAt);
            return { state: next, result: next };
          },
        );
        return { paused: state.paused, sources: state.sources };
      }),

    /** K8 (TASK-052) — the browser extension's capture lane. Consent
     * (the "browser" source above) answers WHETHER the extension may
     * report visits; the domain policy here answers WHICH domains —
     * default-deny, so an empty allowlist captures nothing. The verdict
     * is evaluated on BOTH sides of the process boundary: the extension
     * consults `policy` before a payload exists (a denied domain is
     * never sent anywhere), and `visit` re-evaluates before writing
     * (defense in depth against a stale or bypassed extension). What
     * arrives is already URL-free — the input schema has no url field,
     * and a path-bearing "domain" fails hostname normalization. Private
     * windows never reach this code at all: the extension manifest
     * declares incognito "not_allowed", so the capture path is absent
     * there, not filtered. */
    browser: t.router({
      /** Everything the extension needs to go honestly dormant or
       * capture: flight, consent, kill switch, and the domain lists.
       * Always answerable, like `capture.status`. */
      policy: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .use(organizationGuard).query(async ({ input, ctx }) => {
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          const policy = await readBrowserPolicyState(ctx.wiring, input.organizationId);
          return {
            enabled: ctx.wiring.learningObservationEnabled,
            capturing:
              ctx.wiring.learningObservationEnabled && captureAllowed(consent, "browser"),
            paused: consent.paused,
            allowlist: policy.allowlist,
            denylist: policy.denylist,
          };
        }),

      /** Editing the domain lists is a Human decision, like consent
       * itself. Entries are validated LOUDLY — a typo is refused with
       * the offending entry named, never silently dropped into a
       * narrower policy than the human believes they wrote. */
      setPolicy: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            allowlist: z.array(z.string().min(1).max(253)).max(200),
            denylist: z.array(z.string().min(1).max(253)).max(200),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The browser domain policy is a Human decision — only a user identity may change it",
            });
          }
          const normalize = (entries: string[], list: string) =>
            entries.map((entry) => {
              const domain = normalizeBrowserDomain(entry);
              if (!domain) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `"${entry}" is not a bare domain — ${list} entries look like "github.com" (no scheme, path, or port)`,
                });
              }
              return domain;
            });
          const next = {
            allowlist: [...new Set(normalize(input.allowlist, "allowlist"))],
            denylist: [...new Set(normalize(input.denylist, "denylist"))],
          };
          await ctx.wiring.localPlane.state.update(
            input.organizationId,
            LEARNING_BROWSER_POLICY_NAMESPACE,
            null,
            () => ({ state: next, result: next }),
          );
          return next;
        }),

      /** One reported visit. Never errors on a declined capture — the
       * extension is a background caller, and a structured verdict must
       * not become a retry loop. Idempotent per extension-minted
       * visitId, so a retried POST writes nothing twice. */
      visit: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            visitId: z.string().uuid(),
            domain: z.string().min(1).max(253),
            title: z.string().max(500),
            visitedAt: z.string().datetime(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Browser visits are behavior signals about a human — only that user's own identity may report them",
            });
          }
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          if (!captureAllowed(consent, "browser")) {
            return { captured: false, verdict: "consent_off" as const };
          }
          const policy = await readBrowserPolicyState(ctx.wiring, input.organizationId);
          const verdict = browserCaptureVerdict(policy, input.domain);
          if (verdict !== "allowed") {
            return { captured: false, verdict };
          }
          // Verdict "allowed" implies the domain normalized.
          const domain = normalizeBrowserDomain(input.domain)!;
          const title = input.title.trim().slice(0, 300);
          const signalId = browserCaptureSignalId(input.visitId);
          const owner = { organizationId: input.organizationId, userId: ctx.identity.id };
          if (await ctx.wiring.memoryStore.get(signalId, owner)) {
            return { captured: false, verdict: "duplicate" as const };
          }
          const signal = browserVisitCaptureSignal(
            {
              visitId: input.visitId,
              domain,
              title,
              visitedAt: input.visitedAt,
              // Titles are page-authored text — untrusted web content,
              // labeled as such at the capture boundary.
              taintLabel: labelAtSource("browser_capture", {
                ref: `browser:visit:${input.visitId}`,
                valueHash: hashTaintValue({ domain, title }),
                sensitivity: "private",
                instructionRisk: "instruction_like",
              }),
            },
            owner,
            signalId,
          );
          if (signal) await recordCaptureSignal(ctx.wiring.memoryStore, signal);
          return { captured: true, verdict: "captured" as const };
        }),
    }),

    /** K11 (TASK-054, AP-157) — continuous input capture, the most
     * invasive sensor in the product and the reason K10's hardening had
     * to land first. The user chose FULL CONTENT capture, so the promise
     * is not "we never see sensitive text" — it is that the fail-closed
     * boundary in `@bridge/core/learning/input-capture` decides, and it
     * decides the same way on BOTH sides of the process boundary: the
     * desktop provider distils in memory before anything is sent, and
     * this lane re-distils what arrives (defense in depth against a
     * stale, patched, or bypassed shell). A denylisted app emits nothing
     * at all; a secure or UNDETERMINABLE field yields a marker with no
     * characters and no count; captured text arrives already redacted and
     * is redacted again here. Raw keystrokes have no field on the wire
     * schema, so they cannot reach this endpoint even if a caller tried. */
    input: t.router({
      /** Everything the desktop shell needs to go honestly dormant or
       * capture: flight, consent, kill switch, and the denylist. Always
       * answerable, like `capture.status`. */
      policy: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .use(organizationGuard).query(async ({ input, ctx }) => {
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          const denylist = await readInputDenylistState(ctx.wiring, input.organizationId);
          return {
            enabled: ctx.wiring.learningObservationEnabled,
            capturing:
              ctx.wiring.learningObservationEnabled && captureAllowed(consent, "input"),
            paused: consent.paused,
            apps: denylist.apps,
            domains: denylist.domains,
          };
        }),

      /** Editing the denylist is a Human decision, like consent itself.
       * Invalid entries are refused LOUDLY with the offending entry
       * named, and the seed floor (password managers, banks) is always
       * re-merged by the core builder — a human cannot, by editing, end
       * up with a password manager capturable. */
      setDenylist: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            apps: z.array(z.string().min(1).max(253)).max(200),
            domains: z.array(z.string().min(1).max(253)).max(200),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "The input-capture denylist is a Human decision — only a user identity may change it",
            });
          }
          const { denylist, rejected } = withInputCaptureDenylist({
            apps: input.apps,
            domains: input.domains,
          });
          if (rejected.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${rejected
                .map((entry) => `"${entry}"`)
                .join(", ")} — apps look like "com.apple.mail" and domains like "chase.com" (no scheme, path, or port)`,
            });
          }
          await ctx.wiring.localPlane.state.update(
            input.organizationId,
            LEARNING_INPUT_DENYLIST_NAMESPACE,
            null,
            () => ({ state: denylist, result: denylist }),
          );
          return denylist;
        }),

      /** One distilled input burst from the desktop shell. Never errors on
       * a declined capture — the shell is a background caller and a
       * structured verdict must not become a retry loop. Idempotent per
       * shell-minted burstId. NOTE the wire schema: there is no field for
       * a raw keystroke stream, and `text` is the already-distilled,
       * already-redacted content the provider produced; the server
       * re-runs the SAME core gate over it regardless. */
      burst: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            burstId: z.string().uuid(),
            appName: z.string().min(1).max(200),
            appBundleId: z.string().min(1).max(253),
            host: z.string().max(253).optional(),
            fieldRole: z.enum(["content_ok", "secure", "undeterminable"]),
            /** Already distilled + redacted by the provider. Re-gated here. */
            text: z.string().max(10_000),
            keyCount: z.number().int().min(0).max(100_000),
            typedAt: z.string().datetime(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Input capture is a behavior signal about a human — only that user's own identity may report it",
            });
          }
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          if (!captureAllowed(consent, "input")) {
            return { captured: false, recorded: false, verdict: "consent_off" as const };
          }
          const denylist = await readInputDenylistState(ctx.wiring, input.organizationId);

          // Re-distil server-side through the SAME core boundary the
          // provider used. A shell that was patched, downgraded, or
          // bypassed cannot widen what gets stored.
          const distilled = distilKeystrokeBurst(
            {
              text: input.text,
              keyCount: input.keyCount,
              fieldRole: input.fieldRole as FieldRole,
              appBundleId: input.appBundleId,
              appName: input.appName,
              ...(input.host !== undefined ? { host: input.host } : {}),
            },
            denylist,
          );
          if (distilled === null) {
            return { captured: false, recorded: false, verdict: "denylisted" as const };
          }

          const signalId = inputCaptureSignalId(input.burstId);
          const owner = { organizationId: input.organizationId, userId: ctx.identity.id };
          if (await ctx.wiring.memoryStore.get(signalId, owner)) {
            return { captured: false, recorded: false, verdict: "duplicate" as const };
          }
          const signal = inputCaptureSignal(
            {
              burstId: input.burstId,
              appName: distilled.appName,
              bundleId: distilled.appBundleId,
              summary: distilled.summary,
              ...(distilled.keyCount !== undefined ? { keyCount: distilled.keyCount } : {}),
              ...(distilled.content !== undefined ? { content: distilled.content } : {}),
              disposition: distilled.disposition,
              ...(distilled.suppressionReason
                ? { suppressionReason: distilled.suppressionReason }
                : {}),
              redactionCount: distilled.redactions.length,
              typedAt: input.typedAt,
              // Typed text is the user's own input, but it can contain
              // anything they pasted — labeled untrusted/instruction-like
              // at the capture boundary, like every other captured text.
              taintLabel: labelAtSource("input_capture", {
                ref: `input:burst:${input.burstId}`,
                valueHash: hashTaintValue({
                  app: distilled.appBundleId,
                  disposition: distilled.disposition,
                }),
                sensitivity: "private",
                instructionRisk: "instruction_like",
              }),
            },
            owner,
            signalId,
          );
          if (signal) await recordCaptureSignal(ctx.wiring.memoryStore, signal);
          // `captured` means CONTENT was stored; `recorded` means a Memory
          // row exists. A suppressed burst records a no-content marker, so
          // the two differ — and conflating them would make this lane lie
          // about the one thing it exists to be honest about. Reporting
          // `captured: true` for a secure field is exactly the claim the
          // boundary is built to never make.
          const captured = distilled.disposition === "captured";
          return {
            captured,
            recorded: true,
            verdict: captured ? ("captured" as const) : ("suppressed" as const),
            ...(distilled.suppressionReason
              ? { suppressionReason: distilled.suppressionReason }
              : {}),
          };
        }),
    }),

    /** K7 (TASK-051) — the desktop shell's app-focus capture lane. The
     * "apps" consent source above answers WHETHER the shell may report
     * focus events; the shell's own sensor is additionally stopped at
     * the source while consent is off (the drain loop reconciles), so
     * the gate here is defense in depth, not the only wall. What
     * arrives is already derived — app name, bundle id, window title
     * (null = suppressed fail-closed absent the Accessibility grant) —
     * and flows through the @bridge/sensors hub's full capture
     * contract: capability-manifested provider, inspectable ledger
     * entry, "sensor.capture" blink DomainEvent, and the learning-loop
     * consumer's one durable observed-signal Memory. */
    appfocus: t.router({
      /** Everything the shell's drain loop needs to run or go honestly
       * dormant: flight, consent, kill switch. Always answerable, like
       * `capture.status`. */
      status: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .use(organizationGuard).query(async ({ input, ctx }) => {
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          return {
            enabled: ctx.wiring.learningObservationEnabled,
            capturing:
              ctx.wiring.learningObservationEnabled && captureAllowed(consent, "apps"),
            paused: consent.paused,
          };
        }),

      /** One reported focus event. Never errors on a declined capture —
       * the drain loop is a background caller, and a structured verdict
       * must not become a retry loop. Idempotent per shell-minted
       * focusId, so a re-drained report writes nothing twice. */
      focus: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            focusId: z.string().uuid(),
            appName: z.string().min(1).max(200),
            bundleId: z.string().min(1).max(300),
            windowTitle: z.string().max(500).nullable(),
            focusedAt: z.string().datetime(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "App-focus events are behavior signals about a human — only that user's own identity may report them",
            });
          }
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          if (!captureAllowed(consent, "apps")) {
            return { captured: false, verdict: "consent_off" as const };
          }
          const appName = input.appName.trim();
          const bundleId = input.bundleId.trim();
          if (!appName || !bundleId) {
            return { captured: false, verdict: "malformed" as const };
          }
          const signalId = appFocusCaptureSignalId(input.focusId);
          const owner = { organizationId: input.organizationId, userId: ctx.identity.id };
          if (await ctx.wiring.memoryStore.get(signalId, owner)) {
            return { captured: false, verdict: "duplicate" as const };
          }
          const relayed = await ctx.wiring.appFocusSensor.report(ctx.identity.id, {
            focusId: input.focusId,
            appName,
            bundleId,
            // null stays null — suppression is a fact worth keeping,
            // never repaired into an empty title.
            windowTitle:
              input.windowTitle === null ? null : input.windowTitle.trim().slice(0, 300),
            focusedAt: input.focusedAt,
          });
          if (!relayed) {
            // The lane's provider dropped it (stopped) — structurally
            // possible, never expected under this wiring; surface loudly.
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "the app-focus sensor lane dropped a consented report",
            });
          }
          return { captured: true, verdict: "captured" as const };
        }),
    }),
  }),

  /** K3 (TASK-047, ADR-215) — the knowledge substrate, minimal cut. One
   * substrate, two projections: these procedures are the write path and the
   * human read path over the same entities/claims rows the fusion graph
   * lane retrieves. Claims are born as suggestions (Memory lineage, exactly
   * like preferences) and become knowledge ONLY through Human acceptance,
   * which traverses the governed pipeline before the store materializes
   * anything. Red claim classes are structurally unproposable — the zod
   * enum mirrors the core's closed union, which does not contain them. */
  /**
   * TASK-094 — what has the Capability Builder actually done? Both Builder
   * lanes now leave an Agent Run behind, and this is where you read them.
   * Without it the attribution would exist only in a table nobody queries,
   * which is the same as not existing: "the Builder acted" has to be
   * answerable from outside the Builder.
   *
   * Not a Module Runs list (`modules.recentRuns` is keyed by a Module's own
   * manifest Automations, and the Builder is not a Module) — this is the
   * one Automation the Capability Builder acts under.
   */
  builderRuns: procedure
    .input(z.object({
      organizationId: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input, ctx }) => {
      // Readable whenever EITHER Builder lane can run: rung 3 sits behind
      // the learning flight and rung 4 behind the claim substrate, and a
      // deployment with one of them on has Builder Runs to account for.
      if (!ctx.wiring.learningObservationEnabled && !ctx.wiring.claimSubstrateEnabled) {
        assertLearningFlightEnabled(ctx);
      }
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const runs = await ctx.wiring.automationRunRecorder.list(
        input.organizationId,
        [CAPABILITY_BUILDER_AUTOMATION_ID],
        { limit: input.limit },
      );
      return {
        agentId: CAPABILITY_BUILDER_AGENT,
        runs: runs.map((run) => ({
          runId: run.runId,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt ?? null,
          taskId: run.taskId ?? null,
          output: run.output,
        })),
      };
    }),

  claims: t.router({
    /** Always answerable, like `learning.status`, so clients honestly hide
     * the surface instead of rendering dead controls. */
    status: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return { enabled: ctx.wiring.claimSubstrateEnabled };
      }),

    proposeClaim: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          entity: z.object({
            kind: z.enum(CLAIM_ENTITY_KINDS),
            name: z.string().min(1).max(200),
            refRecordId: z.string().uuid().optional(),
          }),
          field: z.string().min(1).max(80),
          value: z.string().min(1).max(400),
          claimClass: z.enum(PROPOSABLE_CLAIM_CLASSES),
          sensitivity: z.enum(TAINT_SENSITIVITY).default("private"),
          evidence: z
            .array(
              z.object({
                kind: z.enum(["memory", "ledger"]),
                id: z.string().min(1),
                span: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
              }),
            )
            .max(8)
            .default([]),
          validFrom: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        assertHumanIdentity(ctx, "Proposing a claim");
        const claim: ClaimProposal = {
          entity: {
            kind: input.entity.kind,
            name: input.entity.name,
            refRecordId: input.entity.refRecordId ?? null,
          },
          field: input.field,
          value: input.value,
          claimClass: input.claimClass,
          sensitivity: input.sensitivity,
          evidence: input.evidence.map(({ kind, id, span }) => ({ kind, id, ...(span ? { span } : {}) })),
          ...(input.validFrom ? { validFrom: input.validFrom } : {}),
          taintLabel: labelAtSource("human_input", {
            ref: `claim:${input.entity.kind}:${input.entity.name}:${input.field}`,
            valueHash: hashTaintValue({ field: input.field, value: input.value }),
            sensitivity: input.sensitivity,
            instructionRisk: "data",
          }),
        };
        // K10 E5: paraphrase-robust rejection suppression — checks every
        // tier a fingerprint could have been written under (lexical
        // hashing always, semantic in addition when reachable), never
        // just whichever tier happens to be live for this one request.
        const rejectionScope = { organizationId: input.organizationId, userId: ctx.identity.id };
        const suppression = await isSuppressedByRejectionsAnyTier(
          ctx.wiring,
          `${input.field}: ${input.value}`,
          rejectionScope,
          new Date().toISOString(),
        );
        if (suppression.suppressed) {
          return {
            proposed: false as const,
            refused: "rejected_similar" as const,
            reason:
              `too similar to something you already rejected ("${suppression.matchedText}"` +
              `${suppression.permanent ? ", permanently suppressed" : ""}) — ` +
              `delete that rejection fingerprint from Memory to propose it again`,
          };
        }
        try {
          const suggestion = await proposeClaimSuggestion(ctx.wiring.memoryStore, {
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            claim,
            nextId: () => ctx.run.ids.next(),
            // The persistent adapter's lineage column is uuid-typed — same
            // mapping the preference digest uses (K0 regression class).
            lineageIdFor: deterministicUuid,
          });
          return suggestion
            ? { proposed: true as const, suggestion }
            : { proposed: false as const, reason: "This exact claim already has a pending, accepted, or rejected proposal." };
        } catch (error) {
          // K10 E3+E4: the proposal gate's refusals are structured and
          // specific — surfaced verbatim, never smoothed into success.
          if (error instanceof ClaimGateError) {
            return { proposed: false as const, refused: error.reason, reason: error.message };
          }
          throw error;
        }
      }),

    suggestions: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          status: z.enum(["proposed", "accepted", "rejected"]).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
        return {
          suggestions: await listClaimSuggestions(
            ctx.wiring.memoryStore,
            scope,
            input.status,
          ),
        };
      }),

    /** Human acceptance — the ONLY path that writes the claims table, and
     * it traverses the governed pipeline first: reject there means no CAS
     * transition and no row (the "direct-write fails closed" clause of the
     * TASK-047 prototype test). Contradiction with a live same-(entity,
     * field) claim supersedes by lineage inside the store transaction. */
    acceptClaim: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          suggestionMemoryId: z.string().min(1),
          /** K10 E2: the exact text the client rendered to the human. */
          shownText: z.string().max(4000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        assertHumanIdentity(ctx, "Accepting a claim");
        const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
        const row = await ctx.wiring.memoryStore.get(input.suggestionMemoryId, scope);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Claim suggestion not found" });
        const parsed = readClaimSuggestion(row);
        if (!parsed) throw new TRPCError({ code: "BAD_REQUEST", message: "Memory row is not a claim suggestion" });
        if (parsed.status !== "proposed") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Claim suggestion is already ${parsed.status}` });
        }
        let proposal = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
            action: "write",
            resourceType: "claim",
            resourceId: input.suggestionMemoryId,
            inputs: {
              kind: "claim_materialize",
              suggestionMemoryId: input.suggestionMemoryId,
              entityKind: parsed.claim.entity.kind,
              entityName: parsed.claim.entity.name,
              field: parsed.claim.field,
              value: parsed.claim.value,
              claimClass: parsed.claim.claimClass,
              sensitivity: parsed.claim.sensitivity,
            },
            skill: "stageMutation",
            dataScope: "private",
            seed: input.suggestionMemoryId,
          },
          ctx.run,
        );
        // The Human clicking "accept" IS the review decision — record it as
        // one, on the ledger, where the K1 miner will read it back as
        // learning input (the spine feeding itself is the point).
        if (proposal.status === "pending_review") {
          proposal = await ctx.wiring.pipeline.decide(
            proposal.id,
            "approve",
            { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
            ctx.run,
            undefined,
            "Claim accepted by its owner",
          );
        }
        if (proposal.status !== "applied") {
          return { materialized: false as const, proposal: { id: proposal.id, status: proposal.status } };
        }
        const { claim } = await acceptClaimSuggestion(
          ctx.wiring.memoryStore, scope, input.suggestionMemoryId, ctx.identity.id,
          () => ctx.run.ids.next(), input.shownText,
        );
        const materialized = await ctx.wiring.claimStore.materializeClaim({
          organizationId: input.organizationId,
          ownerUserId: ctx.identity.id,
          claim,
          decisionRef: proposal.id,
          createdBy: ctx.identity.id,
        });
        return {
          materialized: true as const,
          proposal: { id: proposal.id, status: proposal.status },
          claim: materialized.claim,
          supersededClaimId: materialized.supersededClaimId,
        };
      }),

    rejectClaim: procedure
      .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        assertHumanIdentity(ctx, "Rejecting a claim");
        const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
        const suggestion = await rejectClaimSuggestion(
          ctx.wiring.memoryStore, scope, input.suggestionMemoryId, ctx.identity.id,
          () => ctx.run.ids.next(),
        );
        // K10 E5: the rejection leaves a fingerprint so the same idea
        // cannot come back merely reworded; strikes escalate 30d → 90d →
        // permanent, and deleting the fingerprint Memory un-suppresses.
        await withRejectionEmbedder(ctx.wiring, (embedder) =>
          recordRejectionFingerprint(ctx.wiring.memoryStore, embedder, {
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            text: `${suggestion.claim.field}: ${suggestion.claim.value}`,
            nowISO: new Date().toISOString(),
            nextId: () => ctx.run.ids.next(),
          }),
        );
        return { suggestion };
      }),

    /**
     * Capability Builder rung 4 (K9, TASK-053): what shape is this person's
     * work already in? Reads the owner's live entities and claims and
     * derives Databases from them - the rung-3 posture applied to the
     * knowledge substrate instead of the ledger.
     *
     * A QUERY, not a mutation, and deliberately: rung 4 proposes a
     * structure, it does not create one. Materializing a proposed Database
     * is a schema change and belongs to the governed pipeline with its own
     * approval, not to the derivation that suggested it.
     *
     * Owner-scoped like every other claims lane - `ctx.identity.id` is the
     * only owner whose claims are read, so one member cannot derive a
     * structure out of another's observations.
     */
    proposeStructure: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { result, runId } = await runAsCapabilityBuilder(
          ctx,
          input.organizationId,
          "claims.proposeStructure",
          async () => {
            const [entities, claims] = await Promise.all([
              ctx.wiring.claimStore.listEntities(input.organizationId, ctx.identity.id),
              ctx.wiring.claimStore.liveClaims(input.organizationId, ctx.identity.id),
            ]);
            const derived = draftStructureFromClaims(
              entities.map((entity) => ({ id: entity.id, kind: entity.kind, name: entity.name })),
              claims.map((claim) => ({
                id: claim.id,
                entityId: claim.entityId,
                field: claim.field,
                value: claim.value,
              })),
              // The never-propose rule is enforced HERE as well as at
              // proposal time: claims materialize through a gate, but a claim
              // that predates a classifier change must not become a column
              // because it once passed.
              (field, value) => classifyClaimContent(field, value).tier === "red",
            );
            return {
              result: derived,
              // The Run says what the Builder READ and what it concluded —
              // a refusal is as much a result as a proposal.
              output: derived.proposed
                ? {
                    proposed: true,
                    databases: derived.databases.map((database) => database.name),
                    evidenceClaimIds: derived.databases.flatMap((database) =>
                      database.columns.flatMap((column) => column.sampleClaimIds)),
                    ...derived.evidence,
                  }
                : { proposed: false, reason: derived.reason },
            };
          },
        );
        return { ...result, runId };
      }),

    entities: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return {
          entities: await ctx.wiring.claimStore.listEntities(input.organizationId, ctx.identity.id),
        };
      }),

    claims: procedure
      .input(z.object({ organizationId: z.string().min(1), entityId: z.string().uuid().optional() }))
      .query(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return {
          claims: await ctx.wiring.claimStore.liveClaims(
            input.organizationId, ctx.identity.id,
            input.entityId ? { entityId: input.entityId } : undefined,
          ),
        };
      }),

    /** Supersedence history for one (entity, field) — the Second Brain's
     * "what did Bridge used to believe, and when did that change" view. */
    claimHistory: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          entityId: z.string().uuid(),
          field: z.string().min(1).max(80),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return {
          history: await ctx.wiring.claimStore.claimHistory(
            input.organizationId, ctx.identity.id, input.entityId, input.field,
          ),
        };
      }),

    /** The user's forget path — the only true delete in the substrate. */
    forgetClaim: procedure
      .input(z.object({ organizationId: z.string().min(1), claimId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertClaimFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        assertHumanIdentity(ctx, "Forgetting a claim");
        const forgotten = await ctx.wiring.claimStore.deleteClaim(
          input.organizationId, ctx.identity.id, input.claimId,
        );
        if (!forgotten) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
        return { forgotten: true as const };
      }),
  }),

  /** K6 (TASK-050) — commitment suggestions mined from the owner's own
   * prose. Suggested-then-accepted: detection (the chat send path) only
   * writes suggestion rows; ACCEPT here is the one path that materializes
   * a Commitment, and it does so through the SAME governed relationship
   * mutation `relationship.createCommitment` uses — the accept click is
   * the Human act the pipeline records. Person linkage is a HUMAN choice
   * at accept time (the detector's counterparty hint is a hint, never an
   * auto-link — the intake rule). */
  commitments: t.router({
    status: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return { enabled: ctx.wiring.learningObservationEnabled };
      }),

    suggestions: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          status: z.enum(["proposed", "accepted", "rejected"]).default("proposed"),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const suggestions = await listCommitmentSuggestions(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.status,
        );
        return { suggestions };
      }),

    accept: procedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          suggestionMemoryId: z.string().uuid(),
          personId: z.string().uuid(),
          /** Optional Human edits at accept time — the suggestion is a draft. */
          text: z.string().trim().min(1).max(2_000).optional(),
          dueAt: relationshipDateTimeSchema.nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        assertHumanIdentity(ctx, "Accepting a commitment suggestion");
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId, ctx.identity.id, input.personId,
        );
        if (!person?.isOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        // Flip the lineage FIRST (idempotency guard: a second accept of the
        // same suggestion fails there instead of minting a second
        // Commitment), then materialize through the governed pipeline.
        const { candidate } = await acceptCommitmentSuggestion(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.suggestionMemoryId,
          ctx.identity.id,
          () => ctx.run.ids.next(),
        );
        const commitmentId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_commitment_mutation",
          operation: "create",
          commitmentId,
          transitionEventId: commitmentId,
          personId: input.personId,
          values: {
            text: input.text ?? candidate.text,
            dueAt: input.dueAt !== undefined ? input.dueAt : candidate.dueAt,
            status: "pending",
          },
        });
        const result = await proposeRelationshipMutation(ctx, input.organizationId, payload);
        return { commitmentId, candidate, ...result };
      }),

    reject: procedure
      .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        assertHumanIdentity(ctx, "Rejecting a commitment suggestion");
        const suggestion = await rejectCommitmentSuggestion(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.suggestionMemoryId,
          ctx.identity.id,
          () => ctx.run.ids.next(),
        );
        return { suggestion };
      }),
  }),

  /** Batched mine-and-digest (AI Harness K1, ADR-212) — mines the governed
   * ledger for human decisions FIRST (the generic learning input that
   * replaced the deleted `recordDealDecision` per-module mapping), then
   * proposes suggestions. Never writes a preference. `moduleId` narrows the
   * digest to one Module; omitted, it fans out across every Module with
   * signals — a generic surface names no Module. */
  digest: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        moduleId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertLearningFlightEnabled(ctx);
      assertPilotOrganization(input.organizationId);
      const ownerUserId = ctx.identity.id;
      const minedResult = await mineLedgerSignals(ctx.wiring.memoryStore, ctx.wiring.ledger, {
        organizationId: input.organizationId,
        ownerUserId,
        signalIdFor: ledgerSignalId,
      });
      const moduleIds = input.moduleId
        ? [input.moduleId]
        : [...new Set([
            ...minedResult.moduleIds,
            ...(await listSignalModuleIds(ctx.wiring.memoryStore, { organizationId: input.organizationId, userId: ownerUserId })),
          ])];
      const created: Awaited<ReturnType<typeof digestLearningSignals>> = [];
      for (const moduleId of moduleIds) {
        created.push(
          ...(await digestLearningSignals(ctx.wiring.memoryStore, {
            organizationId: input.organizationId,
            ownerUserId,
            moduleId,
            nextId: () => ctx.run.ids.next(),
            // The persistent adapter's subject_record_id column is uuid-typed;
            // same convention as the red-flag lineage keys.
            lineageIdFor: deterministicUuid,
          })),
        );
      }
      return {
        suggestions: created,
        mined: { signalCount: minedResult.mined.length, moduleIds },
      };
    }),

  suggestions: t.router({
    list: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          // K1: no per-module default — a generic surface omits this and
          // sees every Module's suggestions.
          moduleId: z.string().min(1).optional(),
          status: z.enum(["proposed", "accepted", "rejected"]).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const suggestions = await listLearningSuggestions(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.moduleId,
          input.status,
        );
        return { suggestions };
      }),

    accept: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          suggestionMemoryId: z.string().min(1),
          /** K10 E2: the exact text the client rendered to the human. */
          shownText: z.string().max(4000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        try {
          const { suggestion, preference } = await acceptLearningSuggestion(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.suggestionMemoryId,
            ctx.identity.id,
            () => ctx.run.ids.next(),
            input.shownText,
          );
          return { suggestionMemoryId: suggestion.id, preferenceMemoryId: preference.id };
        } catch (error) {
          throw learningActionError(error);
        }
      }),

    reject: procedure
      .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        try {
          const rejected = await rejectLearningSuggestion(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.suggestionMemoryId,
            ctx.identity.id,
            () => ctx.run.ids.next(),
          );
          return { suggestionMemoryId: rejected.id };
        } catch (error) {
          throw learningActionError(error);
        }
      }),
  }),

  preferences: t.router({
    list: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          // K1: no per-module default — omitted means every Module's
          // learned preferences (the same all-modules shape chat retrieves).
          moduleId: z.string().min(1).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const preferences = await retrieveLearnedPreferences(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.moduleId,
        );
        return { preferences };
      }),
  }),

  /** Commons capability archetypes (roadmap-v2 Phase 4). Contribution is
   * generalize-then-Human-publish: `preview` derives candidates locally
   * and sends NOTHING; only the explicit `contribute` mutation publishes,
   * and the payload is generalized fields only (screened source-side AND
   * by the Commons server's privacy gate). `seed` is the consume half —
   * archetypes become PROPOSED suggestions on the ordinary lineage
   * machinery (suggested-then-accepted holds; a rejection suppresses). */
  archetypes: t.router({
    preview: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          // K1: REQUIRED — an archetype generalizes a named Module's
          // preferences; the old silent "dealpilot" default was the
          // per-module mapping in disguise.
          moduleId: z.string().min(1),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertArchetypesFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const preferences = await retrieveLearnedPreferences(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.moduleId,
        );
        return { candidates: generalizeLearnedPreferences(preferences, input.moduleId) };
      }),

    contribute: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          moduleId: z.string().min(1),
          /** Candidate names the Human approved for publishing. Empty is
           * NOT "publish everything" — contribution is per-archetype
           * explicit. */
          names: z.array(z.string().min(1)).min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertArchetypesFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const publishArchetype = ctx.wiring.commonsRegistry.publishArchetype?.bind(
          ctx.wiring.commonsRegistry,
        );
        if (!publishArchetype) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "the configured Commons deployment does not support archetypes",
          });
        }
        const preferences = await retrieveLearnedPreferences(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.moduleId,
        );
        const candidates = generalizeLearnedPreferences(preferences, input.moduleId);
        const requested = new Set(input.names);
        const selected = candidates.filter((candidate) => requested.has(candidate.name));
        if (selected.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "no matching archetype candidates" });
        }
        const published: Array<{ name: string; contentHash: string }> = [];
        for (const candidate of selected) {
          try {
            published.push(await publishArchetype(candidate, { tags: [input.moduleId] }));
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : "archetype publish failed",
            });
          }
        }
        return { published };
      }),

    seed: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          moduleId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertArchetypesFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const listArchetypes = ctx.wiring.commonsRegistry.listArchetypes?.bind(
          ctx.wiring.commonsRegistry,
        );
        if (!listArchetypes) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "the configured Commons deployment does not support archetypes",
          });
        }
        const { archetypes } = await listArchetypes({ domain: input.moduleId });
        // Most-corroborated first: the annoyance cap should spend its
        // budget on patterns many organizations converged on. Ties break
        // by name for determinism.
        const ranked = [...archetypes].sort(
          (a, b) =>
            ((b.contributions ?? 1) - (a.contributions ?? 1)) ||
            (supportBandRank(b.archetype.supportBand) - supportBandRank(a.archetype.supportBand)) ||
            a.archetype.name.localeCompare(b.archetype.name),
        );
        const seeded = await seedSuggestionsFromArchetypes(ctx.wiring.memoryStore, {
          organizationId: input.organizationId,
          ownerUserId: ctx.identity.id,
          moduleId: input.moduleId,
          archetypes: ranked.map((entry) => entry.archetype),
          nextId: () => ctx.run.ids.next(),
          lineageIdFor: deterministicUuid,
        });
        return { seeded };
      }),
  }),

  /** Promotion machinery (roadmap-v2 §Capability Evolution): heavily
   * repeated behavior → an Automation DRAFT. Suggested-then-accepted
   * throughout; an accepted draft is saved with status "draft", which the
   * registry's `load` never returns — the executor cannot start it.
   * Activation is a later explicit, governed step, not part of accept. */
  promotions: t.router({
    propose: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          // K1: no per-module default — omitted fans out across every
          // Module with recorded signals.
          moduleId: z.string().min(1).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
        const moduleIds = input.moduleId
          ? [input.moduleId]
          : await listSignalModuleIds(ctx.wiring.memoryStore, scope);
        const suggestions: Awaited<ReturnType<typeof detectAutomationDraftCandidates>> = [];
        for (const moduleId of moduleIds) {
          suggestions.push(
            ...(await detectAutomationDraftCandidates(ctx.wiring.memoryStore, {
              organizationId: input.organizationId,
              ownerUserId: ctx.identity.id,
              moduleId,
              nextId: () => ctx.run.ids.next(),
              lineageIdFor: deterministicUuid,
            })),
          );
        }
        return { suggestions };
      }),

    list: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          // K1: no per-module default — omitted lists every Module's.
          moduleId: z.string().min(1).optional(),
          status: z.enum(["proposed", "accepted", "rejected"]).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const suggestions = await listPromotionSuggestions(
          ctx.wiring.memoryStore,
          { organizationId: input.organizationId, userId: ctx.identity.id },
          input.moduleId,
          input.status,
        );
        return { suggestions };
      }),

    accept: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          suggestionMemoryId: z.string().min(1),
          /** K10 E2: the exact text the client rendered to the human. */
          shownText: z.string().max(4000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        try {
          const { suggestion, draft } = await acceptAutomationDraft(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.suggestionMemoryId,
            ctx.identity.id,
            () => ctx.run.ids.next(),
            input.shownText,
          );
          // Deterministic id: the same accepted pattern always names the
          // same draft row (re-derivable on any instance).
          const automationId = deterministicUuid(
            `learning:promotion:automation:${input.organizationId}:${draft.moduleId}:${draft.pattern.action}:${draft.pattern.attributeKey}=${draft.pattern.attributeValue}`,
          );
          await ctx.wiring.automationRegistry.save({
            id: automationId,
            organizationId: input.organizationId,
            name: draft.name,
            agentId: LEARNING_AGENT,
            agentPlane: "local",
            steps: draft.steps,
            status: "draft",
          });
          return {
            suggestionMemoryId: suggestion.id,
            automationId,
            status: "draft" as const,
            name: draft.name,
            description: draft.description,
          };
        } catch (error) {
          throw learningActionError(error);
        }
      }),

    reject: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          suggestionMemoryId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        try {
          const rejected = await rejectAutomationDraft(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.suggestionMemoryId,
            ctx.identity.id,
            () => ctx.run.ids.next(),
          );
          return { suggestionMemoryId: rejected.id };
        } catch (error) {
          throw learningActionError(error);
        }
      }),

    /** Draft review + activation (ADR-172 follow-up). Drafts are read
     * through `listByStatus` — never `load`, which stays active-only so
     * the executor's seam cannot see one. Activation is the governed
     * step that makes a draft runnable: Human-explicit (this mutation),
     * statically validated (non-empty canonical steps, every skill
     * registered), and everything DEEPER — agent allow-list, taint,
     * approvals — still binds at run time through the same pipeline
     * gates every Automation goes through. Fabricated steps stay
     * impossible: an empty draft simply cannot activate. */
    drafts: t.router({
      list: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
          return { drafts };
        }),

      update: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            automationId: z.string().min(1),
            /** Canonical step shapes — validated by the SAME
             * parseAutomationSteps every registry write goes through. */
            steps: z.array(z.record(z.unknown())).min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
          const draft = drafts.find((definition) => definition.id === input.automationId);
          if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "draft not found" });
          let steps;
          try {
            steps = parseAutomationSteps(input.steps);
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : "invalid steps",
            });
          }
          for (const step of steps) {
            if (!ctx.wiring.skillRegistry.get(step.skill)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `unknown skill "${step.skill}"` });
            }
          }
          await ctx.wiring.automationRegistry.save({ ...draft, steps, status: "draft" });
          return { automationId: draft.id, steps: steps.length, status: "draft" as const };
        }),

      /** K9 rung 3 (TASK-053, ADR-231) — the Capability Builder drafts the
       * STEPS for an accepted promotion. Constrained generation, not
       * codegen — and not even a model call: the step is DERIVED from the
       * ledger episodes behind the pattern (the governed shape the human
       * demonstrably approved ≥6 times), constrained to the live skill
       * registry and the canonical step schema. Refusals are structured
       * and specific (a K7/K8 behavior rhythm has no skill to bind; an
       * unregistered skill proposes nothing; zero remaining episodes
       * proposes nothing). The draft STAYS a draft — the executor still
       * cannot see it, and activation remains the explicit governed step
       * above. */
      proposeSteps: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            automationId: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Drafting steps is part of the Human review of a draft — only a user identity may request it",
            });
          }
          const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
          const draft = drafts.find((definition) => definition.id === input.automationId);
          if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "draft not found" });

          // The pattern lives on the ACCEPTED promotion suggestion whose
          // deterministic automation id names this draft — the same
          // derivation `accept` used, run in reverse by search.
          const accepted = await listPromotionSuggestions(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            undefined,
            "accepted",
          );
          const backing = accepted.find(
            (suggestion) =>
              deterministicUuid(
                `learning:promotion:automation:${input.organizationId}:${suggestion.moduleId}:${suggestion.pattern.action}:${suggestion.pattern.attributeKey}=${suggestion.pattern.attributeValue}`,
              ) === input.automationId,
          );
          if (!backing) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "no accepted promotion pattern backs this draft — nothing to derive steps from",
            });
          }

          const drafted = await runAsCapabilityBuilder(
            ctx,
            input.organizationId,
            "promotions.drafts.proposeSteps",
            async (): Promise<{ result: BuilderStepsLaneResult; output: Record<string, unknown> }> => {
              const { items } = await ctx.wiring.ledger.listHistory(input.organizationId, {
                limit: 200,
                offset: 0,
              });
              const episodes = episodesForSkill(items, backing.pattern.attributeValue);
              const result = draftStepsFromEpisodes(backing.pattern, episodes, (skillId) =>
                Boolean(ctx.wiring.skillRegistry.get(skillId)),
              );
              if (!result.proposed) {
                return {
                  result: { proposed: false as const, reason: result.reason, detail: result.detail },
                  output: { proposed: false, reason: result.reason },
                };
              }
              // The canonical write-boundary validation every registry write
              // gets — the Builder does not bypass it just because it derived
              // the steps itself.
              const steps = parseAutomationSteps(result.steps);
              await ctx.wiring.automationRegistry.save({ ...draft, steps, status: "draft" });
              return {
                result: {
                  proposed: true as const,
                  automationId: draft.id,
                  steps,
                  evidence: result.evidence,
                  status: "draft" as const,
                },
                output: {
                  proposed: true,
                  automationId: draft.id,
                  evidenceLedgerIds: result.evidence.episodeLedgerIds,
                  episodeCount: result.evidence.episodeCount,
                },
              };
            },
          );
          return { ...drafted.result, runId: drafted.runId };
        }),

      activate: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            automationId: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
          const draft = drafts.find((definition) => definition.id === input.automationId);
          if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "draft not found" });
          if (draft.steps.length === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "a draft with no steps cannot activate — give it real governed steps first",
            });
          }
          for (const step of draft.steps) {
            if (!ctx.wiring.skillRegistry.get(step.skill)) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `draft step targets unregistered skill "${step.skill}"`,
              });
            }
          }
          await ctx.wiring.automationRegistry.save({ ...draft, status: "active" });
          return { automationId: draft.id, status: "active" as const };
        }),
    }),
  }),

  /** Retrieval quality read surface (ADR-174). `status` always answers so
   * clients hide the card honestly while the fusion flight is off; `evals`
   * serves recent scheduled runs WITH the honest metric label — these are
   * self-retrieval consistency numbers, never presented as human-judged
   * relevance. */
  retrieval: t.router({
    status: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return { enabled: ctx.wiring.retrievalFusionEnabled };
      }),

    evals: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(50).default(10),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertRetrievalFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const { items, total } = await ctx.wiring.evalStore.listRuns(RETRIEVAL_EVAL_CAPABILITY_ID, {
          limit: input.limit,
          offset: 0,
        });
        return {
          metric: RETRIEVAL_EVAL_METRIC,
          metricNote: RETRIEVAL_EVAL_METRIC_NOTE,
          total,
          // Store order is oldest-first; the card wants newest-first.
          runs: [...items].reverse().map((run) => ({
            runId: run.id,
            startedAt: run.started_at,
            datasetId: run.dataset_id,
            embeddingModel: run.capability_version,
            cases: run.perCase.length,
            recallAtK: run.aggregate.route_r ?? 0,
            precisionAtK: run.aggregate.route_p ?? 0,
            mrr: run.aggregate.success ?? 0,
          })),
        };
      }),
  }),
});
