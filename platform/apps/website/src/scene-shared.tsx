import type { CSSProperties, ReactNode } from "react";
import copy from "./copy.json";
import { scrollToScene } from "./hooks";

export type ChapterId = "values" | "process" | "difference" | "impact";

export const chapterTargets: ReadonlyArray<{ id: ChapterId; title: string }> = [
  { id: "values", title: copy.library.books[0] },
  { id: "process", title: copy.library.books[1] },
  { id: "difference", title: copy.library.books[2] },
  { id: "impact", title: copy.library.books[3] },
];

export const cast = [
  { ...copy.family.cast[0], species: "owl" as const, pose: "working" as const },
  { ...copy.family.cast[1], species: "fox" as const, pose: "reading" as const },
  { ...copy.family.cast[2], species: "elephant" as const, pose: "carrying" as const },
  { ...copy.family.cast[3], species: "beaver" as const, pose: "building" as const },
  { ...copy.family.cast[4], species: "swan" as const, pose: "presenting" as const },
  { ...copy.family.cast[5], species: "dolphin" as const, pose: "presenting" as const },
] as const;

export interface ProgressStyle extends CSSProperties {
  "--scene-progress"?: number;
  "--parallax-x"?: string;
  "--parallax-y"?: string;
  "--camera-rotation"?: string;
  "--transition-scale"?: number;
  "--transition-opacity"?: number;
  "--dictionary-tilt"?: string;
  "--ledger-rotation"?: string;
  "--ledger-opacity"?: number;
}

export function BackToBooks() {
  return (
    <button className="back-to-books" type="button" onClick={() => scrollToScene("library")}>
      <span aria-hidden="true">{"\u2190"}</span>
      {copy.library.back}
    </button>
  );
}

export function ChapterMarker({ count, active }: { count: number; active: number }) {
  return (
    <div className="chapter-marker" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={index === active ? "is-active" : ""} />
      ))}
    </div>
  );
}

export function OwnerFigure({
  className = "",
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`owner-figure ${className}`} aria-hidden="true">
      <span className="owner-figure__head" />
      <span className="owner-figure__body" />
      <span className="owner-figure__arm owner-figure__arm--left" />
      <span className="owner-figure__arm owner-figure__arm--right" />
      {children}
    </div>
  );
}

export function ProgressPlant({ className = "" }: { className?: string }) {
  return (
    <div className={`progress-plant ${className}`} aria-hidden="true">
      <span className="progress-plant__stem" />
      <span className="progress-plant__leaf progress-plant__leaf--one" />
      <span className="progress-plant__leaf progress-plant__leaf--two" />
      <span className="progress-plant__leaf progress-plant__leaf--three" />
      <span className="progress-plant__pot" />
    </div>
  );
}

export function PaperStack({ className = "", count = 3 }: { className?: string; count?: number }) {
  return (
    <span className={`paper-stack ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} style={{ "--paper-index": index } as CSSProperties} />
      ))}
    </span>
  );
}

export const stepIndex = (progress: number, count: number) =>
  Math.min(count - 1, Math.max(0, Math.floor(progress * count)));
