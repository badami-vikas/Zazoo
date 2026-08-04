import { useState, type CSSProperties } from "react";
import { useReducedMotion, useSceneProgress } from "../hooks";
import copy from "./copy.json";
import { Person } from "./section-organization";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function sceneAt(progress: number): number {
  if (progress < 0.12) return 1;
  if (progress < 0.4) return 2;
  if (progress < 0.55) return 3;
  if (progress < 0.72) return 4;
  return 5;
}

export function InfrastructureScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);

  const scene = sceneAt(progress);
  const questionCount =
    scene < 2 ? 0 : scene > 2 ? 6 : Math.min(6, 1 + Math.floor(clamp01((progress - 0.12) / 0.28) * 6));
  const definitionRevealed = progress >= 0.82;

  return (
    <section
      id="infrastructure"
      ref={ref}
      className="scene scene--infrastructure"
      data-active={active}
      aria-label="The same task runs twice; only the environment changes"
    >
      <div
        className="scene__sticky infrastructure-stage"
        data-scene={scene}
        data-question={activeQuestion ?? "none"}
        data-reduced-motion={reducedMotion}
      >
        <p className="infra-task">{copy.infrastructure.task}</p>

        <div className="infra-world" aria-hidden="true">
          <Person className="infra-employee" />
          <div className="infra-card">
            <span />
            <span />
            <span />
            <span />
          </div>

          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className={`infra-detour infra-detour--${index}`}
              style={{ "--question-index": index } as CSSProperties}
            >
              <i className="infra-detour__loop" />
              <i className="infra-detour__mark" />
            </span>
          ))}

          <div className="infra-environment">
            <span className="infra-shelf" />
            <span className="infra-owner-flag" />
            <span className="infra-decision-cards" />
            <span className="infra-approval-path" />
            <Person className="infra-colleague infra-colleague--one" />
            <Person className="infra-colleague infra-colleague--two" />
            <span className="infra-companion infra-companion--one" />
            <span className="infra-companion infra-companion--two" />
            <span className="infra-boundary" />
          </div>

          <span className="infra-route infra-route--tangled" />
          <span className="infra-route infra-route--clear" />

          <div className="infra-grid">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} style={{ "--cell-index": index } as CSSProperties}>
                <i />
              </span>
            ))}
          </div>
        </div>

        <div className="infra-questions" role="group" aria-label="Questions the environment creates">
          {copy.infrastructure.questions.map((question, index) => (
            <button
              key={question}
              type="button"
              data-emerged={index < questionCount}
              aria-pressed={activeQuestion === index}
              tabIndex={questionCount > index ? 0 : -1}
              style={{ "--question-index": index } as CSSProperties}
              onClick={() => setActiveQuestion((current) => (current === index ? null : index))}
            >
              {question}
            </button>
          ))}
        </div>

        <div className="infra-definition" data-revealed={definitionRevealed}>
          <h2>{copy.infrastructure.definitionHeading}</h2>
          <p className="infra-definition__lead">{copy.infrastructure.definition}</p>
          <p className="infra-definition__supporting">{copy.infrastructure.supporting}</p>
          <p className="infra-definition__contrast">{copy.infrastructure.contrast}</p>
          <p className="infra-definition__closing">{copy.infrastructure.closing}</p>
        </div>
      </div>
    </section>
  );
}
