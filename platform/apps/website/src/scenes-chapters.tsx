import { useState } from "react";
import { QuietRobot, ZazooCharacter } from "./characters";
import copy from "./copy.json";
import { useEscape, useReducedMotion, useSceneProgress } from "./hooks";
import {
  BackToBooks,
  cast,
  ChapterMarker,
  OwnerFigure,
  PaperStack,
  ProgressPlant,
  stepIndex,
  type ProgressStyle,
} from "./scene-shared";

function ValueIllustration({ index }: { index: number }) {
  return (
    <div className={`value-illustration value-illustration--${index + 1}`} aria-hidden="true">
      <div className="value-watercolor" />
      <ZazooCharacter
        species="owl"
        pose={index === 1 ? "building" : index === 4 ? "carrying" : "working"}
        className="value-aeva"
      />
      {index === 0 && (
        <>
          <span className="meeting-door meeting-door--left" />
          <span className="meeting-door meeting-door--right" />
          <span className="coffee-cup" />
          <PaperStack className="next-folder" count={2} />
        </>
      )}
      {index === 1 && (
        <>
          <span className="process-bridge">
            <i />
            <i />
            <i />
          </span>
          <span className="bridge-wrench" />
          <span className="working-crowd" />
        </>
      )}
      {index === 2 && (
        <>
          <span className="solution solution--ornate">
            <i />
            <i />
            <i />
          </span>
          <span className="solution solution--simple">
            <i />
          </span>
          <OwnerFigure className="value-owner" />
        </>
      )}
      {index === 3 && (
        <>
          <span className="permission-door" />
          <span className="knocking-lines" />
          <span className="owner-hand" />
          <PaperStack className="proposed-action" count={1} />
        </>
      )}
      {index === 4 && (
        <>
          <span className="rain-cloud rain-cloud--one" />
          <span className="rain-cloud rain-cloud--two" />
          <span className="umbrella" />
          <OwnerFigure className="value-owner" />
          <span className="first-raindrop" />
        </>
      )}
    </div>
  );
}

export function ValuesScene() {
  const { ref, progress, active } = useSceneProgress();
  const reducedMotion = useReducedMotion();
  const index = stepIndex(progress, copy.values.lines.length);

  return (
    <section
      id="values"
      ref={ref}
      className="scene scene--values chapter-scene"
      data-active={active}
      data-reduced-motion={reducedMotion}
      aria-label="Five acts that show how a Zazoo behaves"
    >
      <div className="scene__sticky chapter-stage value-stage">
        <BackToBooks />
        <h2>{copy.values.heading}</h2>
        <div className="chapter-page-edge chapter-page-edge--left" aria-hidden="true" />
        <div className="chapter-page-edge chapter-page-edge--right" aria-hidden="true" />
        <ValueIllustration key={index} index={index} />
        <p className="value-line">{copy.values.lines[index]}</p>
        <ChapterMarker count={copy.values.lines.length} active={index} />
        <div className="wet-footprint-transition" aria-hidden="true">
          {Array.from({ length: 5 }, (_, footprint) => <span key={footprint} />)}
        </div>
      </div>
    </section>
  );
}

function ProcessIllustration({ stage }: { stage: number }) {
  return (
    <div className={`process-illustration process-illustration--${stage + 1}`} aria-hidden="true">
      <span className="process-path">
        {Array.from({ length: 18 }, (_, index) => (
          <i key={index} className={index <= stage * 4 ? "is-formed" : ""} />
        ))}
      </span>
      <ZazooCharacter
        species="owl"
        pose={stage === 2 ? "carrying" : stage === 4 ? "reading" : "walking"}
        className="process-aeva"
      />
      {stage === 0 && (
        <>
          <span className="reading-desk" />
          <PaperStack className="process-documents" count={4} />
          <span className="insight-thread" />
        </>
      )}
      {stage === 1 && (
        <>
          <span className="path-fork path-fork--left" />
          <span className="path-fork path-fork--right" />
          <OwnerFigure className="process-owner" />
          <span className="open-proposal" />
        </>
      )}
      {stage === 2 && (
        <>
          <span className="shared-table" />
          <ZazooCharacter species="fox" pose="reading" className="process-companion process-companion--one" />
          <ZazooCharacter species="elephant" pose="carrying" className="process-companion process-companion--two" />
          <PaperStack className="delegated-work delegated-work--one" count={1} />
          <PaperStack className="delegated-work delegated-work--two" count={1} />
        </>
      )}
      {stage === 3 && (
        <>
          {cast.slice(1).map((member, index) => (
            <ZazooCharacter
              key={member.name}
              species={member.species}
              pose={member.pose}
              className={`execution-companion execution-companion--${index + 1}`}
            />
          ))}
          <span className="execution-output" />
        </>
      )}
      {stage === 4 && (
        <>
          <span className="field-notebook">
            <i />
            <i />
          </span>
          <span className="learned-route" />
          <span className="removed-obstacle" />
        </>
      )}
    </div>
  );
}

export function ProcessScene() {
  const { ref, progress, active } = useSceneProgress();
  const [continued, setContinued] = useState(false);
  const rawStage = stepIndex(progress, copy.process.stages.length);
  const stage = !continued && rawStage >= 1 ? 1 : rawStage;

  const continueJourney = () => {
    setContinued(true);
    const sceneNode = ref.current;
    if (!sceneNode) return;
    const target = sceneNode.offsetTop + sceneNode.offsetHeight * 0.43;
    if (window.scrollY < target) window.scrollTo({ top: target, behavior: "smooth" });
  };

  return (
    <section
      id="process"
      ref={ref}
      className="scene scene--process chapter-scene"
      data-active={active}
      data-stage={stage}
      aria-label="Aeva turns insight into action while pausing for a human decision"
    >
      <div className="scene__sticky chapter-stage process-stage">
        <BackToBooks />
        <h2>{copy.process.heading}</h2>
        <ol className="process-labels">
          {copy.process.stages.map((label, index) => (
            <li key={label} className={index === stage ? "is-active" : index < stage ? "is-past" : ""}>
              {label}
            </li>
          ))}
        </ol>
        <ProcessIllustration key={stage} stage={stage} />
        {stage === 1 && !continued && (
          <div className="decision-pause">
            <p>{copy.process.support}</p>
            <button type="button" onClick={continueJourney}>
              {copy.process.continue}
            </button>
          </div>
        )}
        <ChapterMarker count={copy.process.stages.length} active={stage} />
        <span className="route-line-transition" aria-hidden="true" />
      </div>
    </section>
  );
}

function DifferenceTableau({ index }: { index: number }) {
  const mountain = index === 7;
  return (
    <div
      className={`difference-tableau difference-tableau--${index + 1} ${mountain ? "difference-tableau--mountain" : ""}`}
      aria-hidden="true"
    >
      {!mountain && (
        <>
          <div className="typical-world">
            <span className="chat-window">
              <i />
              <i />
              <i />
            </span>
            <QuietRobot />
            <span className="typical-prop typical-prop--one" />
            <span className="typical-prop typical-prop--two" />
            {index === 6 && (
              <span className="isolated-robots">
                {Array.from({ length: 4 }, (_, robot) => <QuietRobot key={robot} />)}
              </span>
            )}
          </div>
          <div className="zazoo-world">
            <span className="connected-path connected-path--one" />
            <span className="connected-path connected-path--two" />
            <span className="connected-path connected-path--three" />
            <ZazooCharacter
              species="owl"
              pose={index === 3 || index === 5 ? "carrying" : "working"}
              className="difference-aeva"
            />
            <OwnerFigure className="difference-owner" />
            <PaperStack className="difference-paper difference-paper--one" count={1} />
            <PaperStack className="difference-paper difference-paper--two" count={2} />
            <span className="difference-curtain" />
            <span className="difference-bridge" />
            {index === 6 && (
              <span className="crew-cluster">
                {cast.slice(1).map((member, memberIndex) => (
                  <ZazooCharacter
                    key={member.name}
                    species={member.species}
                    pose={member.pose}
                    className={`crew-cluster__member crew-cluster__member--${memberIndex + 1}`}
                  />
                ))}
              </span>
            )}
          </div>
        </>
      )}
      {mountain && (
        <div className="difference-mountain">
          <span className="mountain-slope mountain-slope--rear" />
          <span className="mountain-slope mountain-slope--front" />
          <span className="mountain-bridge" />
          <span className="mountain-rope" />
          <span className="mountain-lantern" />
          <OwnerFigure className="mountain-owner" />
          {cast.map((member, memberIndex) => (
            <ZazooCharacter
              key={member.name}
              species={member.species}
              pose="walking"
              className={`mountain-crew mountain-crew--${memberIndex + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DifferenceScene() {
  const { ref, progress, active } = useSceneProgress();
  const index = stepIndex(progress, copy.difference.vignettes.length);
  const vignette = copy.difference.vignettes[index];

  return (
    <section
      id="difference"
      ref={ref}
      className="scene scene--difference chapter-scene"
      data-active={active}
      data-vignette={index + 1}
      aria-label="Eight scenes contrast a passive robot with a present Zazoo crew"
    >
      <div className="scene__sticky chapter-stage difference-stage">
        <BackToBooks />
        <h2>{copy.difference.heading}</h2>
        <DifferenceTableau key={index} index={index} />
        <div className="difference-caption">
          {vignette.detail && <p className="difference-detail">{vignette.detail}</p>}
          <p>{vignette.caption}</p>
        </div>
        <ChapterMarker count={copy.difference.vignettes.length} active={index} />
        <span className="lantern-page-transition" aria-hidden="true" />
      </div>
    </section>
  );
}

export function ImpactScene() {
  const { ref, progress, active } = useSceneProgress();
  const [notebookOpen, setNotebookOpen] = useState(false);
  useEscape(() => setNotebookOpen(false), notebookOpen);
  const style: ProgressStyle = { "--scene-progress": progress };
  const phase = stepIndex(progress, 6);

  return (
    <section
      id="impact"
      ref={ref}
      className="scene scene--impact chapter-scene"
      data-active={active}
      data-phase={phase}
      style={style}
      aria-label="The owner advances while the Zazoo crew quietly removes friction"
    >
      <div className="scene__sticky chapter-stage impact-stage">
        <BackToBooks />
        <div className="impact-copy">
          <h2>{copy.impact.heading}</h2>
          <p>{copy.impact.body}</p>
        </div>
        <div className="impact-office" aria-hidden="true">
          <span className="impact-desk" />
          <span className="impact-path" />
          <span className="impact-stone impact-stone--one" />
          <span className="impact-stone impact-stone--two" />
          <span className="impact-stone impact-stone--three" />
          <OwnerFigure className="impact-owner" />
          <ZazooCharacter species="owl" pose="working" className="impact-aeva" />
          {cast.slice(1).map((member, index) => (
            <ZazooCharacter
              key={member.name}
              species={member.species}
              pose={member.pose}
              className={`impact-crew impact-crew--${index + 1}`}
            />
          ))}
          <ProgressPlant className="impact-plant" />
          <span className="impact-stage-light" />
          <span className="impact-audience" />
        </div>
        <button
          className="impact-notebook"
          type="button"
          aria-label="Review illustrated completed chapters"
          aria-expanded={notebookOpen}
          onPointerEnter={() => setNotebookOpen(true)}
          onPointerLeave={() => setNotebookOpen(false)}
          onFocus={() => setNotebookOpen(true)}
          onBlur={() => setNotebookOpen(false)}
          onClick={() => setNotebookOpen(true)}
        >
          <span aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
        <span className="evening-dust-transition" aria-hidden="true" />
      </div>
    </section>
  );
}
