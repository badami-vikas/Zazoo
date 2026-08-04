import { useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion, useSceneProgress } from "../hooks";
import copy from "./copy.json";
import { Person } from "./section-organization";

export function JourneyScene() {
  const { ref, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [lens, setLens] = useState(0);
  const stageRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectStage = (index: number) => {
    setStage(index);
    setLens(0);
  };

  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.min(copy.journey.stages.length - 1, Math.max(0, stage + delta));
    selectStage(next);
    stageRefs.current[next]?.focus();
  };

  const selected = copy.journey.stages[stage];

  return (
    <section
      id="journey"
      ref={ref}
      className="scene scene--journey"
      data-active={active}
      aria-label="Five states of one organization along a single path"
    >
      <div
        className="journey-stage"
        data-stage={stage}
        data-lens={lens}
        data-reduced-motion={reducedMotion}
      >
        <header className="journey-copy">
          <h2>{copy.journey.heading}</h2>
          <p>{copy.journey.intro}</p>
        </header>

        <div className="journey-illustration" aria-hidden="true">
          <span className="journey-org__outline" />
          <div className="journey-org">
            {(["one", "two", "three"] as const).map((dept) => (
              <div key={dept} className={`journey-dept journey-dept--${dept}`}>
                <span className="journey-dept__frame" />
                <Person className="journey-worker journey-worker--a" />
                <Person className="journey-worker journey-worker--b" />
                <span className="journey-tool" />
                <span className="journey-workflow" />
              </div>
            ))}
            <span className="journey-shared" />
            <span className="journey-governance" />
            <span className="journey-value" />
            <Person className="journey-leader" />
          </div>
          <span className="journey-next-link" data-visible={stage < copy.journey.stages.length - 1} />
        </div>

        <div
          className="journey-path"
          role="group"
          aria-label="Five organizational states"
          onKeyDown={onStageKeyDown}
        >
          <span className="journey-path__line" aria-hidden="true" />
          {copy.journey.stages.map((entry, index) => (
            <button
              key={entry.title}
              ref={(element) => {
                stageRefs.current[index] = element;
              }}
              type="button"
              className="journey-node"
              aria-expanded={stage === index}
              onClick={() => selectStage(index)}
            >
              <span className="journey-node__marker" aria-hidden="true" />
              {entry.title}
            </button>
          ))}
        </div>

        <article className="journey-panel" key={selected.title}>
          <h3>{selected.title}</h3>
          <p>{selected.description}</p>
          <div className="journey-lenses" role="group" aria-label="Examine this state">
            {copy.journey.lenses.map((label, index) => (
              <button
                key={label}
                type="button"
                aria-pressed={lens === index}
                onClick={() => setLens(index)}
              >
                {label}
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
