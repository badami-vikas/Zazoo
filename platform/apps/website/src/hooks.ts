import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

export interface SceneProgress<T extends HTMLElement> {
  ref: RefObject<T>;
  progress: number;
  active: boolean;
}

export function useSceneProgress<T extends HTMLElement>(): SceneProgress<T> {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const next = clamp(-rect.top / travel);
    setProgress((current) => (Math.abs(current - next) > 0.002 ? next : current));
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setActive(entry?.isIntersecting ?? false);
        measure();
      },
      { rootMargin: "25% 0px", threshold: [0, 0.01, 0.5, 1] },
    );

    const element = ref.current;
    if (element) observer.observe(element);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    measure();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return { ref, progress, active };
}

export function useEscape(handler: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handler]);
}

export function scrollToScene(id: string, behavior: ScrollBehavior = "smooth"): void {
  document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
}
