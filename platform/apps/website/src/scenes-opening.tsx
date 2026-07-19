import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { QuietRobot, ZazooCharacter } from "./characters";
import copy from "./copy.json";
import { scrollToScene, useEscape, useReducedMotion, useSceneProgress } from "./hooks";
import {
  cast,
  chapterTargets,
  PaperStack,
  ProgressPlant,
  type ChapterId,
  type ProgressStyle,
} from "./scene-shared";

export function HeroScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [greeting, setGreeting] = useState(false);

  const moveCamera = (event: PointerEvent<HTMLElement>) => {
    if (reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 24;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 24;
    setParallax({ x, y });
  };

  const transitionProgress = Math.min(1, Math.max(0, (progress - 0.78) / 0.22));
  const stageStyle: ProgressStyle = {
    "--parallax-x": `${parallax.x.toFixed(1)}px`,
    "--parallax-y": `${parallax.y.toFixed(1)}px`,
    "--camera-rotation": `${(progress * 76).toFixed(1)}deg`,
    "--transition-scale": 0.2 + transitionProgress * 0.8,
    "--transition-opacity": transitionProgress,
  };

  return (
    <section
      id="hero"
      ref={ref}
      className="scene scene--hero"
      data-active={active}
      aria-label="Aeva begins a working day"
      onPointerMove={moveCamera}
      onPointerLeave={() => setParallax({ x: 0, y: 0 })}
    >
      <div className="scene__sticky hero-stage" style={stageStyle}>
        <header className="hero-nav">
          <span className="wordmark">{copy.hero.wordmark}</span>
          <button type="button" onClick={() => scrollToScene("family")}>
            {copy.hero.action}
          </button>
        </header>

        <div className="hero-copy">
          <h1>{copy.hero.heading}</h1>
          <p>{copy.hero.subhead}</p>
        </div>

        <div className="working-world" aria-hidden="true">
          <span className="orbit orbit--outer" />
          <span className="orbit orbit--middle" />
          <span className="orbit orbit--inner" />
          <span className="workstation workstation--notes">
            <i />
            <i />
            <i />
          </span>
          <span className="workstation workstation--research">
            <i />
          </span>
          <PaperStack className="workstation workstation--documents" />
          <span className="workstation workstation--calendar">
            {Array.from({ length: 6 }, (_, index) => <i key={index} />)}
          </span>
          <span className="workstation workstation--reminder">
            <i />
          </span>
          <span className="workstation workstation--dashboard">
            <i />
            <i />
            <i />
          </span>
          <span className="workstation workstation--idea">
            <i />
          </span>
          <ProgressPlant className="workstation workstation--plant" />
          <span className="traveling-paper traveling-paper--one" />
          <span className="traveling-paper traveling-paper--two" />
          <span className="traveling-paper traveling-paper--three" />
        </div>

        <button
          className="hero-aeva"
          type="button"
          aria-label="Aeva is working"
          onPointerEnter={() => setGreeting(true)}
          onPointerLeave={() => setGreeting(false)}
          onFocus={() => setGreeting(true)}
          onBlur={() => setGreeting(false)}
        >
          <ZazooCharacter species="owl" pose="working" className={greeting ? "is-greeting" : ""} />
        </button>

        <div className="hero-bubbles" aria-live="off">
          {copy.hero.bubbles.map((bubble, index) => (
            <span key={bubble} style={{ "--bubble-index": index } as CSSProperties}>
              {bubble}
            </span>
          ))}
        </div>

        <div className="hero-dictionary-transition" aria-hidden="true">
          <span />
          <i />
        </div>
      </div>
    </section>
  );
}

export function FamilyScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const [selected, setSelected] = useState<number | null>(null);
  const officeRef = useRef<HTMLDivElement>(null);
  const pointerActivationRef = useRef<number | null>(null);
  const clickedSelectionRef = useRef<number | null>(null);
  const close = useCallback(() => {
    setSelected(null);
    clickedSelectionRef.current = null;
  }, []);
  useEscape(close, selected !== null);

  useEffect(() => {
    if (selected === null) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!officeRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close, selected]);

  const closeProgress = Math.min(1, Math.max(0, (progress - 0.72) / 0.28));
  const stageStyle: ProgressStyle = {
    "--dictionary-tilt": `${(2 + closeProgress * 5).toFixed(1)}deg`,
  };

  return (
    <section
      id="family"
      ref={ref}
      className="scene scene--family"
      data-active={active}
      aria-label="The Zazoo definition and family at work"
    >
      <div className="scene__sticky dictionary-stage" style={stageStyle}>
        <div className="dictionary-spread">
          <article className="dictionary-page dictionary-page--entry">
            <div className="dictionary-term-row">
              <h2>{copy.family.term}</h2>
              <span>{copy.family.pronunciation}</span>
              <em>{copy.family.partOfSpeech}</em>
            </div>
            <dl>
              <div>
                <dt>{copy.family.definitionLabel}</dt>
                <dd>{copy.family.definition}</dd>
              </div>
              <div>
                <dt>{copy.family.purposeLabel}</dt>
                <dd>{copy.family.purpose}</dd>
              </div>
            </dl>
            <blockquote>{copy.family.quote}</blockquote>
            <span className="dictionary-pronunciation-ring" aria-hidden="true" />
          </article>

          <div
            ref={officeRef}
            className="dictionary-page dictionary-page--office"
            data-selected={selected === null ? "none" : selected}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <span className="office-floor-path" aria-hidden="true" />
            {cast.map((member, index) => (
              <button
                key={member.name}
                className={`family-member family-member--${index + 1}`}
                type="button"
                aria-expanded={selected === index}
                aria-label={`${member.name}, ${member.role}`}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") {
                    setSelected(index);
                    clickedSelectionRef.current = null;
                  }
                }}
                onPointerDown={() => {
                  pointerActivationRef.current = index;
                }}
                onClick={() => {
                  if (selected === index && clickedSelectionRef.current === index) {
                    close();
                  } else {
                    clickedSelectionRef.current = index;
                    setSelected(index);
                  }
                  pointerActivationRef.current = null;
                }}
                onFocus={() => {
                  if (pointerActivationRef.current !== index) {
                    setSelected(index);
                    clickedSelectionRef.current = null;
                  }
                }}
                onBlur={() => {
                  pointerActivationRef.current = null;
                }}
              >
                <span className="family-workspace" aria-hidden="true">
                  <PaperStack count={index === 1 ? 4 : 2} />
                  <i />
                  <i />
                </span>
                <ZazooCharacter species={member.species} pose={member.pose} />
                <span className="family-label">
                  <strong>{member.name}</strong>
                  <small>{member.role}</small>
                </span>
                {selected === index && (
                  <span className="family-introduction">
                    <strong>{member.name}</strong>
                    <span>{member.role}</span>
                    {index === 1 && <p>{copy.family.linaIntroduction}</p>}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className="dictionary-gutter" aria-hidden="true" />
        </div>
        <div className="dictionary-drawbridge" aria-hidden="true">
          <span />
          <ZazooCharacter species="owl" pose="walking" />
        </div>
      </div>
    </section>
  );
}

export function GovernanceScene() {
  const { ref, progress, active } = useSceneProgress<HTMLElement>();
  const [emphasis, setEmphasis] = useState<number | null>(null);
  const ledgerProgress = Math.min(1, Math.max(0, (progress - 0.78) / 0.22));
  const stageStyle: ProgressStyle = {
    "--ledger-rotation": `${(-5 + ledgerProgress * 5).toFixed(1)}deg`,
    "--ledger-opacity": ledgerProgress,
  };

  return (
    <section
      id="governance"
      ref={ref}
      className="scene scene--governance"
      data-active={active}
      aria-label="Aeva passes a work request through a calm permission boundary"
    >
      <div className="scene__sticky governance-stage" style={stageStyle}>
        <h2>{copy.governance.heading}</h2>
        <div className="castle" aria-hidden="true">
          <span className="castle__arch castle__arch--left" />
          <span className="castle__arch castle__arch--center" />
          <span className="castle__arch castle__arch--right" />
          <span className="castle__door castle__door--allowed" />
          <span className="castle__door castle__door--closed" />
          <span className="castle__curtain castle__curtain--left" />
          <span className="castle__curtain castle__curtain--right" />
          <span className="castle__vault" />
          <span className="castle__request" />
          <ZazooCharacter species="owl" pose="walking" className="castle__aeva" />
          <ZazooCharacter species="owl" pose="reading" className="guardian guardian--judge" />
          <ZazooCharacter species="elephant" pose="carrying" className="guardian guardian--security" />
          <ZazooCharacter species="dog" pose="working" className="guardian guardian--gatekeeper" />
          <ZazooCharacter species="bear" pose="working" className="guardian guardian--auditor" />
          <QuietRobot className="castle__robot" />
          <span className="castle__denial">{copy.governance.denial}</span>
        </div>

        <div className="governance-inscriptions">
          {copy.governance.pairs.map(([first, second], index) => (
            <button
              key={first}
              className={emphasis === index ? "is-emphasized" : ""}
              type="button"
              onPointerEnter={() => setEmphasis(index)}
              onPointerLeave={() => setEmphasis(null)}
              onFocus={() => setEmphasis(index)}
              onBlur={() => setEmphasis(null)}
              aria-label={`${first} ${second}`}
            >
              <span>{first}</span>
              <span>{second}</span>
            </button>
          ))}
        </div>

        <div className="governance-props">
          <button type="button" aria-label="Emphasize the permission rule" onFocus={() => setEmphasis(0)}>
            <span className="prop-rulebook" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Emphasize the permission key" onFocus={() => setEmphasis(1)}>
            <span className="prop-key" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Emphasize the inspectable ledger" onFocus={() => setEmphasis(2)}>
            <span className="prop-ledger" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Emphasize the permitted doorway" onFocus={() => setEmphasis(3)}>
            <span className="prop-doorway" aria-hidden="true" />
          </button>
        </div>
        <span className="ledger-transition" aria-hidden="true" />
      </div>
    </section>
  );
}

export function LibraryScene() {
  const { ref, active } = useSceneProgress<HTMLElement>();
  const reducedMotion = useReducedMotion();
  const [selected, setSelected] = useState<ChapterId | null>(null);
  const timerRef = useRef<number | null>(null);
  const closeBook = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setSelected(null);
  }, []);
  useEscape(closeBook, selected !== null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const openBook = (id: ChapterId) => {
    setSelected(id);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => {
        timerRef.current = null;
        scrollToScene(id, reducedMotion ? "auto" : "smooth");
      },
      reducedMotion ? 0 : 720,
    );
  };

  return (
    <section
      id="library"
      ref={ref}
      className="scene scene--library"
      data-active={active}
      data-selected={selected ?? "none"}
      aria-label="A library of four Zazoo chapters"
    >
      <div className="library-light" aria-hidden="true" />
      <h2>{copy.library.heading}</h2>
      <div className="library-doorways" aria-hidden="true">
        {chapterTargets.map(({ id }) => <span key={id} className={`doorway doorway--${id}`} />)}
      </div>
      <div className="library-table">
        <ZazooCharacter species="owl" pose="working" className="library-aeva" />
        <div className="chapter-books">
          {chapterTargets.map(({ id, title }, index) => (
            <button
              key={id}
              type="button"
              className={`chapter-book chapter-book--${id}`}
              aria-pressed={selected === id}
              onClick={() => openBook(id)}
              style={{ "--book-index": index } as CSSProperties}
            >
              <span className="chapter-book__spine" aria-hidden="true" />
              <span className="chapter-book__cover">{title}</span>
              <span className="chapter-book__pages" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
