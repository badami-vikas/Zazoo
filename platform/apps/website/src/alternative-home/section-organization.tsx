import { useEffect, useRef, useState } from "react";
import { useReducedMotion, useSceneProgress } from "../hooks";
import copy from "./copy.json";

export function Person({ className = "" }: { className?: string }) {
  return (
    <span className={`alt-person ${className}`} aria-hidden="true">
      <i className="alt-person__head" />
      <i className="alt-person__body" />
    </span>
  );
}

const STAGE_COUNT = 6;

export function OrganizationScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const [manual, setManual] = useState<number | null>(null);
  const manualBaseRef = useRef(0);

  const scrollStage = Math.min(STAGE_COUNT - 1, Math.floor(progress * STAGE_COUNT));
  const stage = manual ?? scrollStage;

  const chooseStage = (value: number) => {
    manualBaseRef.current = scrollStage;
    setManual(value);
  };

  useEffect(() => {
    if (manual !== null && scrollStage !== manualBaseRef.current) setManual(null);
  }, [manual, scrollStage]);

  return (
    <section
      id="organization"
      ref={ref}
      className="scene scene--organization"
      data-active={active}
      aria-label="One organization transforms one relationship at a time"
    >
      <div
        className="scene__sticky organization-stage"
        data-reduced-motion={reducedMotion}
        data-knowledge={stage >= 1}
        data-decisions={stage >= 2}
        data-capability={stage >= 3}
        data-memory={stage >= 4}
        data-settled={stage >= 5}
      >
        <header className="organization-copy">
          <h2 data-revealed={stage >= 1}>{copy.organization.heading}</h2>
          <p data-revealed={stage >= 1}>{copy.organization.subheading}</p>
        </header>

        <div className="org-living" aria-hidden="true">
          {(["one", "two", "three"] as const).map((dept, index) => (
            <div key={dept} className={`org-dept org-dept--${dept}`}>
              <span className="org-dept__boundary" />
              {Array.from({ length: 3 }, (_, person) => (
                <Person key={person} className={`org-worker org-worker--${person}`} />
              ))}
              <i className={`doc-chip doc-chip--held doc-chip--${dept}`} />
              {index > 0 && <span className="org-practice" />}
            </div>
          ))}
          <div className="org-ladder">
            <Person className="org-manager org-manager--top" />
            <Person className="org-manager org-manager--mid" />
            <span className="org-decision-path" />
            <span className="org-decision-short" />
          </div>
          <span className="org-success" />
          <span className="org-current" />
          <Person className="org-leaver" />
          <span className="org-memory-chip" />
          <span className="org-task-outro" />
        </div>

        <ul className="organization-lines">
          {copy.organization.lines.map((line, index) => (
            <li key={line} data-revealed={stage >= index + 1}>
              {line}
            </li>
          ))}
        </ul>
        <p className="organization-closing" data-revealed={stage >= 5}>
          {copy.organization.closing}
        </p>

        <div className="organization-controls" role="group" aria-label="Change one relationship at a time">
          {copy.organization.controls.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={stage >= index + 1}
              onClick={() => chooseStage(index + 1)}
            >
              {label}
            </button>
          ))}
          <button
            className="organization-compare"
            type="button"
            aria-pressed={stage === 0}
            onClick={() => chooseStage(0)}
          >
            {copy.organization.compare}
          </button>
        </div>
      </div>
    </section>
  );
}
