# SONOZZ — Design System (Master)

Source of truth for UI/UX. Overrides generic UI/UX Pro Max music defaults where they conflict with brand.

## Product

- **Type:** Music AI studio + streaming player
- **Audience:** Creators shipping fictional or real artists end-to-end
- **Feel:** Premium dark studio, calm confidence, metal/brass warmth — not neon cyberpunk, not purple SaaS

## Brand (locked)

| Token | Value | Role |
|-------|-------|------|
| Ink | `#0c0f12` | OLED base |
| Surface | `#111418` / `#1a1f26` | Panels |
| Fog | `#f2efe6` | Text |
| Brass | `#c9a227` | Primary / CTA |
| Moss | `#3d6b5a` | Secondary |
| Ember | `#d4784a` | Accent |

- **Display:** Syne (extrabold, tracking tight)
- **Body:** Figtree
- Do **not** switch to Righteous/Poppins or Spotify green — keep brass identity

## Style direction

- **OLED Dark** + subtle depth (gradients, grain already on body)
- Block layouts, large type on hero, generous gaps (32–48px)
- Glass only sparingly (header blur) — no heavy glassmorphism
- Cards only when they hold interaction (pricing, artist pickers)

## Motion language (Motion / Preact — not React Framer)

| Kind | Duration | Distance | Use |
|------|----------|----------|-----|
| Page enter | 280–320ms | 6–8px Y | One per route |
| Reveal (scroll) | 300–400ms | 12px Y | Sections below fold |
| Press | 120–160ms | scale 0.96–0.98 | CTA / play |
| Hover | 150–220ms | scale 1.015 / lift | Cards, rows |
| Modal | 220–280ms | 10px Y + 0.98→1 | Dialogs |
| Chrome (player bar) | 320–400ms | slide Y | Now Playing |

**Rules**
- Ease-out for enter, ease-in for exit — never linear UI motion
- **One** page-level entrance only (no nested FadeIn stacks)
- Infinite motion = loaders only (UI/UX Pro Max)
- Always honor `prefers-reduced-motion`
- Micro-interactions > decorative loops

## UX checklist (ship gate)

- [ ] Lucide icons only (no emoji icons)
- [ ] `cursor-pointer` on clickable controls
- [ ] Hover 150–300ms
- [ ] Visible focus rings (brass)
- [ ] Contrast ≥ 4.5:1 on text
- [ ] Responsive 375 / 768 / 1024 / 1440
- [ ] Audio player always reachable (Now Playing)

## Anti-patterns

- Purple-to-indigo gradients, cream+terracotta “AI default”
- Stacked entrance animations that hide content then cascade
- Continuous bounce/glow on static icons
- Cluttered first viewport (hero = brand + one line + CTA + atmosphere)

## Stack notes

- Astro islands + **Preact only**
- Animations via `motion` (DOM API), wrappers in `src/components/ui/Motion.jsx`
- DaisyUI theme `sonozz` + Tailwind 4
