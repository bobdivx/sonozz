import { useEffect, useRef } from "preact/hooks";
import { animate, stagger } from "motion";
import { EASE_OUT_EXPO, EASE_OUT_SOFT, prefersReducedMotion } from "../../lib/motionPrefs.js";

/**
 * Entrée fade + rise (API Motion vanilla — compatible Preact, sans React).
 */
export function FadeIn({
  children,
  class: className = "",
  delay = 0,
  y = 14,
  duration = 0.45,
  as: Tag = "div",
  ...rest
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReducedMotion()) {
      el.style.opacity = "1";
      el.style.transform = "none";
      return undefined;
    }
    el.style.opacity = "0";
    const controls = animate(
      el,
      { opacity: [0, 1], transform: [`translateY(${y}px)`, "translateY(0px)"] },
      { duration, delay, easing: EASE_OUT_SOFT },
    );
    return () => controls.stop();
  }, [delay, duration, y]);

  return (
    <Tag ref={ref} class={className} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Révèle les enfants en cascade (cartes artistes, nav, étapes).
 */
export function Stagger({
  children,
  class: className = "",
  selector = ":scope > *",
  step = 0.055,
  y = 16,
  duration = 0.42,
  startDelay = 0.04,
  as: Tag = "div",
  ...rest
}) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const items = root.querySelectorAll(selector);
    if (!items.length) return undefined;
    if (prefersReducedMotion()) {
      items.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return undefined;
    }
    items.forEach((el) => {
      el.style.opacity = "0";
    });
    const controls = animate(
      items,
      { opacity: [0, 1], transform: [`translateY(${y}px)`, "translateY(0px)"] },
      {
        delay: stagger(step, { startDelay }),
        duration,
        easing: EASE_OUT_EXPO,
      },
    );
    return () => controls.stop();
  }, [selector, step, y, duration, startDelay]);

  return (
    <Tag ref={ref} class={className} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Micro-interaction press (boutons play, CTA) — scale 0.94 → 1.
 */
export function Pressable({
  children,
  class: className = "",
  as: Tag = "button",
  scale = 0.94,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  ...rest
}) {
  const ref = useRef(null);

  function bump(to) {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    animate(el, { transform: `scale(${to})` }, { duration: 0.16, easing: EASE_OUT_SOFT });
  }

  return (
    <Tag
      ref={ref}
      class={className}
      {...rest}
      onPointerDown={(e) => {
        bump(scale);
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        bump(1);
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        bump(1);
        onPointerLeave?.(e);
      }}
      onPointerCancel={(e) => {
        bump(1);
        onPointerCancel?.(e);
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * Slide-in depuis le bas (barre Now Playing).
 */
export function useSlideUp(ref, { when = true, duration = 0.5 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !when) return undefined;
    if (prefersReducedMotion()) {
      el.style.transform = "none";
      el.style.opacity = "1";
      return undefined;
    }
    const controls = animate(
      el,
      { opacity: [0, 1], transform: ["translateY(110%)", "translateY(0%)"] },
      { duration, easing: EASE_OUT_EXPO },
    );
    return () => controls.stop();
  }, [ref, when, duration]);
}

/**
 * Pulse léger sur la jaquette pendant la lecture.
 */
export function usePlayingPulse(ref, playing) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReducedMotion() || !playing) {
      el.style.transform = "scale(1)";
      return undefined;
    }
    const controls = animate(
      el,
      { transform: ["scale(1)", "scale(1.04)", "scale(1)"] },
      { duration: 2.8, easing: "ease-in-out", repeat: Infinity },
    );
    return () => {
      controls.stop();
      el.style.transform = "scale(1)";
    };
  }, [ref, playing]);
}

/**
 * Overlay modal : fade backdrop + panel scale/rise.
 */
export function ModalShell({
  children,
  class: className = "",
  panelClass = "",
  onBackdrop,
  zClass = "z-50",
  role,
  "aria-modal": ariaModal,
  "aria-labelledby": ariaLabelledby,
}) {
  const backdropRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!backdrop || !panel) return undefined;
    if (prefersReducedMotion()) {
      backdrop.style.opacity = "1";
      panel.style.opacity = "1";
      return undefined;
    }
    const a = animate(backdrop, { opacity: [0, 1] }, { duration: 0.22, easing: "ease-out" });
    const b = animate(
      panel,
      {
        opacity: [0, 1],
        transform: ["translateY(20px) scale(0.96)", "translateY(0px) scale(1)"],
      },
      { duration: 0.38, easing: EASE_OUT_EXPO },
    );
    return () => {
      a.stop();
      b.stop();
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      class={`fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm ${zClass} ${className}`}
      style={{ opacity: prefersReducedMotion() ? 1 : 0 }}
      onClick={onBackdrop}
      role="presentation"
    >
      <div
        ref={panelRef}
        class={panelClass}
        style={{ opacity: prefersReducedMotion() ? 1 : 0 }}
        onClick={(e) => e.stopPropagation()}
        role={role}
        aria-modal={ariaModal}
        aria-labelledby={ariaLabelledby}
      >
        {children}
      </div>
    </div>
  );
}
