import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion, useSceneProgress } from "../hooks";
import copy from "./copy.json";
import { eraEvidence, type EraId, type EvidencePair } from "./evidence";

const ERA_IDS: readonly EraId[] = ["steam", "electricity", "computing", "internet", "ai"];
const HERO_STEPS = 2;
const AI_STEPS = 3;

interface EraRange {
  id: EraId;
  start: number;
  steps: number;
  pairs: EvidencePair[];
}

function buildRanges(extended: Partial<Record<EraId, boolean>>) {
  let cursor = HERO_STEPS;
  const ranges: EraRange[] = [];
  for (const id of ERA_IDS) {
    if (id === "ai") {
      ranges.push({ id, start: cursor, steps: AI_STEPS, pairs: [] });
      cursor += AI_STEPS;
      continue;
    }
    const era = eraEvidence[id];
    const pairs = extended[id] ? [...era.base, ...era.extended] : era.base;
    const steps = Math.max(1, pairs.length * 3);
    ranges.push({ id, start: cursor, steps, pairs });
    cursor += steps;
  }
  return { ranges, total: cursor };
}

function OrgRigid({ era, assistants = false }: { era: EraId; assistants?: boolean }) {
  return (
    <div className={`org-rigid org-rigid--${era}`} aria-hidden="true">
      <span className="org-rigid__roof" />
      <div className="org-rigid__floors">
        {Array.from({ length: 3 }, (_, floor) => (
          <div key={floor} className="org-rigid__floor">
            {Array.from({ length: 4 }, (_, cell) => (
              <span key={cell} className="org-rigid__cell">
                {assistants && <i className="org-rigid__assistant" />}
              </span>
            ))}
          </div>
        ))}
      </div>
      <span className="org-rigid__tech" />
      <span className="org-rigid__bolt-line" />
    </div>
  );
}

function OrgTransformed({ era }: { era: EraId }) {
  return (
    <div className={`org-flow org-flow--${era}`} aria-hidden="true">
      <span className="org-flow__core" />
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="org-flow__path" style={{ "--node-index": index } as CSSProperties} />
      ))}
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="org-flow__node" style={{ "--node-index": index } as CSSProperties} />
      ))}
    </div>
  );
}

function Blueprint() {
  return (
    <div className="org-blueprint" aria-hidden="true">
      <span className="org-blueprint__outline" />
      <span className="org-blueprint__line org-blueprint__line--one" />
      <span className="org-blueprint__line org-blueprint__line--two" />
      <span className="org-blueprint__line org-blueprint__line--three" />
      <span className="org-blueprint__corner org-blueprint__corner--nw" />
      <span className="org-blueprint__corner org-blueprint__corner--se" />
      {Array.from({ length: 4 }, (_, index) => (
        <span key={index} className="org-blueprint__form" style={{ "--form-index": index } as CSSProperties} />
      ))}
      <span className="org-blueprint__pathway" />
    </div>
  );
}

function EvidenceColumn({
  label,
  pair,
  side,
  revealed,
}: {
  label: string;
  pair: EvidencePair | null;
  side: "transitional" | "transformational";
  revealed: boolean;
}) {
  const evidence = pair ? pair[side] : null;
  return (
    <div className={`shift-column shift-column--${side}`} data-revealed={revealed}>
      <h3>{label}</h3>
      {evidence && (
        <div className="shift-evidence" key={pair!.id}>
          <p className="shift-evidence__org">{evidence.org}</p>
          {evidence.fragments.length > 0 && (
            <ul className="shift-evidence__fragments">
              {evidence.fragments.slice(0, 4).map((fragment) => (
                <li key={fragment}>{fragment}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function ShiftsScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const [extended, setExtended] = useState<Partial<Record<EraId, boolean>>>({});
  const pendingStepRef = useRef<number | null>(null);
  const { ranges, total } = buildRanges(extended);

  const stepFloat = Math.min(total - 0.001, Math.max(0, progress * total));
  const globalStep = Math.floor(stepFloat);
  const heroProgress = Math.min(1, stepFloat / HERO_STEPS);
  const inHero = globalStep < HERO_STEPS;

  const range =
    ranges.find((candidate) => globalStep >= candidate.start && globalStep < candidate.start + candidate.steps) ??
    ranges[0];
  const currentEra: EraId = inHero ? "steam" : range.id;
  const eraStep = Math.max(0, globalStep - range.start);
  const pairIndex = Math.min(Math.max(0, range.pairs.length - 1), Math.floor(eraStep / 3));
  const pair = range.pairs[pairIndex] ?? null;
  const beat = currentEra === "ai" ? eraStep : eraStep % 3;

  const jumpToEra = (id: EraId) => {
    const element = ref.current;
    const target = ranges.find((candidate) => candidate.id === id);
    if (!element || !target) return;
    const rect = element.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const top = window.scrollY + rect.top + ((target.start + 0.05) / total) * travel;
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const showMore = (id: EraId) => {
    pendingStepRef.current = globalStep;
    setExtended((current) => ({ ...current, [id]: true }));
  };

  useLayoutEffect(() => {
    if (pendingStepRef.current === null) return;
    const element = ref.current;
    const step = pendingStepRef.current;
    pendingStepRef.current = null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const top = window.scrollY + rect.top + ((step + 0.5) / total) * travel;
    window.scrollTo({ top, behavior: "auto" });
    // The section height just changed; useSceneProgress only re-measures on
    // scroll/resize, so force one measurement to keep the current step in view.
    window.dispatchEvent(new Event("resize"));
  }, [ref, total]);

  const hasMore =
    currentEra !== "ai" && !extended[currentEra] && eraEvidence[currentEra].extended.length > 0;

  const stageStyle: CSSProperties = {
    "--hero-progress": heroProgress,
  } as CSSProperties;

  return (
    <section
      id="shifts"
      ref={ref}
      className="scene scene--shifts"
      data-active={active}
      style={{ "--shift-steps": total } as CSSProperties}
      aria-label="The same pattern repeats across five technology eras"
    >
      <div className="scene__sticky shifts-stage" style={stageStyle} data-hero={inHero} data-era={currentEra}>
        <div className="shifts-hero" aria-hidden={!inHero}>
          <h1>{copy.shifts.heading}</h1>
          <div className="shifts-hero__body">
            {copy.shifts.body.map((line, index) => (
              <p key={line} style={{ "--line-index": index } as CSSProperties}>
                {line}
              </p>
            ))}
          </div>
          <div className="shifts-hero__actions">
            <a className="shift-action shift-action--primary" href={copy.shifts.bookHref} tabIndex={inHero ? 0 : -1}>
              {copy.shifts.book}
            </a>
            <button
              className="shift-action shift-action--unavailable"
              type="button"
              aria-disabled="true"
              tabIndex={inHero ? 0 : -1}
            >
              {copy.shifts.assess}
            </button>
          </div>
        </div>

        <div className="shifts-film" data-visible={!inHero}>
          <div className="era-selector" role="group" aria-label="Choose an era">
            {ERA_IDS.map((id, index) => (
              <button
                key={id}
                type="button"
                className={`era-choice era-choice--${id}`}
                aria-pressed={!inHero && currentEra === id}
                onClick={() => jumpToEra(id)}
              >
                <span className={`era-emblem era-emblem--${id}`} aria-hidden="true" />
                {copy.shifts.eras[index]}
              </button>
            ))}
          </div>

          <div className="shifts-compare" data-beat={Math.min(2, beat)} key={currentEra}>
            {currentEra !== "ai" ? (
              <>
                <div className="shifts-side shifts-side--left">
                  <EvidenceColumn
                    label={copy.shifts.columns[0]}
                    pair={pair}
                    side="transitional"
                    revealed={beat >= 0}
                  />
                  <div className="shifts-illustration" key={pair?.id ?? "empty"}>
                    <OrgRigid era={currentEra} />
                  </div>
                  {currentEra === "internet" && (
                    <p className="shifts-observation-half" data-revealed={beat >= 2}>
                      {copy.shifts.internetObservation[0]}
                    </p>
                  )}
                </div>
                <div className="shifts-side shifts-side--right" data-revealed={beat >= 1}>
                  <EvidenceColumn
                    label={copy.shifts.columns[1]}
                    pair={pair}
                    side="transformational"
                    revealed={beat >= 1}
                  />
                  <div className="shifts-illustration" key={pair?.id ?? "empty"}>
                    <OrgTransformed era={currentEra} />
                  </div>
                  {currentEra === "internet" && (
                    <p className="shifts-observation-half" data-revealed={beat >= 2}>
                      {copy.shifts.internetObservation[1]}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="shifts-side shifts-side--left">
                  <h3 className="shift-column__label">{copy.shifts.columns[0]}</h3>
                  <div className="shifts-illustration">
                    <OrgRigid era="ai" assistants={beat >= 0} />
                  </div>
                </div>
                <div className="shifts-side shifts-side--right" data-revealed={beat >= 1}>
                  <h3 className="shift-column__label">{copy.shifts.columns[1]}</h3>
                  <div className="shifts-illustration">
                    <Blueprint />
                  </div>
                </div>
              </>
            )}
          </div>

          {currentEra !== "ai" ? (
            <footer className="shifts-foot">
              <p className="shifts-observation" data-revealed={beat >= 2}>
                {copy.shifts.bottomObservation}
              </p>
              {hasMore && (
                <button className="shifts-more" type="button" onClick={() => showMore(currentEra)}>
                  {copy.shifts.more}
                </button>
              )}
            </footer>
          ) : (
            <footer className="shifts-foot shifts-foot--ai" data-beat={beat}>
              <p className="shifts-observation" data-revealed={beat >= 1}>
                {copy.shifts.aiClosing}
              </p>
              <p className="shifts-reflection" data-revealed={beat >= 2}>
                {copy.shifts.reflection}
              </p>
            </footer>
          )}
        </div>
      </div>
    </section>
  );
}
