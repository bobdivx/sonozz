import { useEffect, useRef } from "preact/hooks";
import { animate, stagger, inView } from "motion";
import { EASE_OUT_EXPO, EASE_OUT_SOFT, prefersReducedMotion } from "../../lib/motionPrefs.js";

/** Entrée page unique — courte, peu de déplacement (évite l’effet « cascade bizarre »). */
export function PageEnter({
  children,
  class: className = "",
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
    const controls = animate(
      el,
      { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0px)"] },
      { duration: 0.32, easing: EASE_OUT_SOFT },
    );
    return () => controls.stop();
  }, []);

  return (
    <Tag
      ref={ref}
      class={className}
      style={{ opacity: 0 }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Fade léger pour un bloc isolé (modale, overlay) — pas pour wrapper toute une page.
 */
export function FadeIn({
  children,
  class: className = "",
  delay = 0,
  y = 8,
  duration = 0.3,
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
    const controls = animate(
      el,
      { opacity: [0, 1], transform: [`translateY(${y}px)`, "translateY(0px)"] },
      { duration, delay, easing: EASE_OUT_SOFT },
    );
    return () => controls.stop();
  }, [delay, duration, y]);

  return (
    <Tag ref={ref} class={className} style={{ opacity: 0 }} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Cascade courte sur une grille — max ~6 items visibles, mouvement discret.
 * À utiliser hors PageEnter (sinon double opacités).
 */
export function Stagger({
  children,
  class: className = "",
  selector = ":scope > *",
  step = 0.04,
  y = 10,
  duration = 0.28,
  startDelay = 0.02,
  as: Tag = "div",
  ...rest
}) {
  const ref = useRef(null);
  const ran = useRef(false);

  useEffect(() => {
    const root = ref.current;
    if (!root || ran.current) return undefined;
    const items = [...root.querySelectorAll(selector)].slice(0, 8);
    if (!items.length) return undefined;
    ran.current = true;

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
        easing: EASE_OUT_SOFT,
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
 * Révèle au scroll (sections below-fold) — une fois.
 */
export function Reveal({
  children,
  class: className = "",
  y = 14,
  duration = 0.38,
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
    el.style.transform = `translateY(${y}px)`;
    return inView(
      el,
      () => {
        animate(
          el,
          { opacity: 1, transform: "translateY(0px)" },
          { duration, easing: EASE_OUT_EXPO },
        );
      },
      { margin: "0px 0px -8% 0px", amount: 0.2 },
    );
  }, [y, duration]);

  return (
    <Tag ref={ref} class={className} style={{ opacity: 0 }} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Hover lift discret (cartes, rows) — CSS-first + motion boost.
 */
export function HoverLift({
  children,
  class: className = "",
  as: Tag = "div",
  scale = 1.015,
  onPointerEnter,
  onPointerLeave,
  ...rest
}) {
  const ref = useRef(null);

  function onEnter(e) {
    const el = ref.current;
    if (el && !prefersReducedMotion()) {
      animate(el, { transform: `scale(${scale})` }, { duration: 0.2, easing: EASE_OUT_SOFT });
    }
    onPointerEnter?.(e);
  }
  function onLeave(e) {
    const el = ref.current;
    if (el && !prefersReducedMotion()) {
      animate(el, { transform: "scale(1)" }, { duration: 0.22, easing: EASE_OUT_SOFT });
    }
    onPointerLeave?.(e);
  }

  return (
    <Tag
      ref={ref}
      class={`origin-center will-change-transform ${className}`}
      {...rest}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {children}
    </Tag>
  );
}

/**
 * Micro-interaction press (boutons play, CTA).
 */
export function Pressable({
  children,
  class: className = "",
  as: Tag = "button",
  scale = 0.96,
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
    animate(el, { transform: `scale(${to})` }, { duration: 0.14, easing: EASE_OUT_SOFT });
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

export function useSlideUp(ref, { when = true, duration = 0.36 } = {}) {
  const ran = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !when || ran.current) return undefined;
    ran.current = true;
    if (prefersReducedMotion()) {
      el.style.transform = "none";
      el.style.opacity = "1";
      return undefined;
    }
    const controls = animate(
      el,
      { opacity: [0, 1], transform: ["translateY(100%)", "translateY(0%)"] },
      { duration, easing: EASE_OUT_SOFT },
    );
    return () => controls.stop();
  }, [ref, when, duration]);
}

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
      { transform: ["scale(1)", "scale(1.03)", "scale(1)"] },
      { duration: 3.2, easing: "ease-in-out", repeat: Infinity },
    );
    return () => {
      controls.stop();
      el.style.transform = "scale(1)";
    };
  }, [ref, playing]);
}

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
      panel.style.transform = "none";
      return undefined;
    }
    const a = animate(backdrop, { opacity: [0, 1] }, { duration: 0.18, easing: "ease-out" });
    const b = animate(
      panel,
      {
        opacity: [0, 1],
        transform: ["translateY(12px) scale(0.98)", "translateY(0px) scale(1)"],
      },
      { duration: 0.28, easing: EASE_OUT_SOFT },
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
      style={{ opacity: 0 }}
      onClick={onBackdrop}
      role="presentation"
    >
      <div
        ref={panelRef}
        class={panelClass}
        style={{ opacity: 0 }}
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
