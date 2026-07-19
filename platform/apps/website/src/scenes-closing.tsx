import { useState } from "react";
import { ZazooCharacter } from "./characters";
import copy from "./copy.json";
import { useReducedMotion, useSceneProgress } from "./hooks";
import {
  cast,
  OwnerFigure,
  PaperStack,
  ProgressPlant,
  stepIndex,
  type ProgressStyle,
} from "./scene-shared";

export function NightScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const reducedFrame = stepIndex(progress, 6);
  const act = progress < 0.3 ? "office" : progress < 0.56 ? "cottage" : "dream";
  const privacyVisible = progress >= 0.16 && progress < 0.42;
  const style: ProgressStyle = { "--scene-progress": progress };

  return (
    <section
      id="night"
      ref={ref}
      className="scene scene--night"
      data-active={active}
      data-act={act}
      data-frame={reducedMotion ? reducedFrame : undefined}
      style={style}
      aria-label="Aeva closes the office, rests privately, and dreams of lighting the owner's path"
    >
      <div className="scene__sticky night-stage">
        <div className="night-office" aria-hidden="true">
          <span className="night-window" />
          <span className="night-desk" />
          <span className="night-curtain night-curtain--left" />
          <span className="night-curtain night-curtain--right" />
          <PaperStack className="night-notebooks" count={3} />
          <ZazooCharacter species="owl" pose="working" className="night-aeva night-aeva--office" />
          {cast.slice(1).map((member, index) => (
            <ZazooCharacter
              key={member.name}
              species={member.species}
              pose="walking"
              className={`night-departure night-departure--${index + 1}`}
            />
          ))}
          <span className="office-light office-light--one" />
          <span className="office-light office-light--two" />
          <span className="office-light office-light--three" />
        </div>

        <div className="cottage-path" aria-hidden="true">
          <span className="moon" />
          <span className="path-stone path-stone--one" />
          <span className="path-stone path-stone--two" />
          <span className="path-stone path-stone--three" />
          <span className="cottage">
            <i className="cottage__roof" />
            <i className="cottage__window" />
            <i className="cottage__door" />
            <i className="cottage__shelf" />
            <i className="cottage__bed" />
            <i className="cottage__portrait" />
            <i className="cottage__lamp" />
            <i className="cottage__badge" />
          </span>
          <ZazooCharacter species="owl" pose="walking" className="night-aeva night-aeva--path" />
          <ZazooCharacter species="owl" pose="sleeping" className="night-aeva night-aeva--sleeping" />
        </div>

        <div className="dream-world" aria-hidden="true">
          <span className="dream-sky" />
          <span className="dream-mountain dream-mountain--back" />
          <span className="dream-mountain dream-mountain--front" />
          <span className="dream-branch" />
          <span className="dream-stone dream-stone--one" />
          <span className="dream-stone dream-stone--two" />
          <span className="dream-bridge" />
          <span className="dream-lantern" />
          <OwnerFigure className="dream-owner" />
          <ZazooCharacter species="owl" pose="walking" className="dream-aeva" />
        </div>

        {privacyVisible && <p className="privacy-status">{copy.night.status}</p>}
        {act === "dream" && <p className="dream-line">{copy.night.line}</p>}
        <span className="morning-light-transition" aria-hidden="true" />
      </div>
    </section>
  );
}

export function MorningScene() {
  const { ref, active } = useSceneProgress<HTMLElement>();
  const [ctaFocused, setCtaFocused] = useState(false);

  return (
    <section
      id="morning"
      ref={ref}
      className="scene scene--morning"
      data-active={active}
      data-cta-focused={ctaFocused}
      aria-label="Aeva wakes and returns to a new morning of work"
    >
      <div className="scene__sticky morning-stage">
        <div className="morning-cottage" aria-hidden="true">
          <span className="morning-bed" />
          <span className="morning-badge" />
          <span className="morning-door" />
          <ZazooCharacter species="owl" pose="resting" className="morning-aeva morning-aeva--waking" />
          <ZazooCharacter species="owl" pose="walking" className="morning-aeva morning-aeva--walking" />
        </div>

        <div className="morning-world" aria-hidden="true">
          <span className="morning-orbit morning-orbit--outer" />
          <span className="morning-orbit morning-orbit--inner" />
          <span className="morning-calendar">
            {Array.from({ length: 6 }, (_, index) => <i key={index} />)}
          </span>
          <PaperStack className="morning-document" count={1} />
          <ProgressPlant className="morning-plant" />
          <span className="morning-note" />
          <ZazooCharacter
            species="owl"
            pose="working"
            className={`morning-aeva morning-aeva--working ${ctaFocused ? "is-glancing" : ""}`}
          />
        </div>

        <div className="final-invitation">
          <h2>{copy.final.heading}</h2>
          <p>{copy.final.body}</p>
          <button
            type="button"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
            onPointerEnter={() => setCtaFocused(true)}
            onPointerLeave={() => setCtaFocused(false)}
            onFocus={() => setCtaFocused(true)}
            onBlur={() => setCtaFocused(false)}
          >
            {copy.final.action}
          </button>
        </div>

        <footer>
          <span className="wordmark">{copy.final.wordmark}</span>
        </footer>
      </div>
    </section>
  );
}
