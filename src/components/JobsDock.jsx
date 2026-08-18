import { useEffect, useRef, useState } from "preact/hooks";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Ban,
  Film,
  Zap,
  Layers,
  Share2,
  ChevronUp,
  ChevronDown,
  Music2,
} from "lucide-preact";
import {
  clearFinishedJobs,
  listJobs,
  subscribeJobs,
} from "../lib/jobStore.js";
import { bootJobRunner, dismissJob } from "../lib/jobRunner.js";
import { api } from "../lib/apiClient.js";
import { mirrorAlbumJob } from "../lib/albumJobMirror.js";

function StatusIcon({ status }) {
  if (status === "running") return <Loader2 size={14} class="animate-spin text-primary" />;
  if (status === "done") return <CheckCircle2 size={14} class="text-success" />;
  if (status === "interrupted") return <AlertTriangle size={14} class="text-warning" />;
  return <XCircle size={14} class="text-error" />;
}

function TypeIcon({ type }) {
  if (type === "pipeline") return <Zap size={12} />;
  if (type === "step") return <Layers size={12} />;
  if (type === "album") return <Layers size={12} />;
  if (type === "track") return <Music2 size={12} />;
  if (type === "publish") return <Share2 size={12} />;
  return <Film size={12} />;
}

function JobsList({ visible, active, recent }) {
  return (
    <>
      <ul class="space-y-2">
        {visible.map((job) => (
          <li
            key={job.id}
            class={`rounded-lg border px-2.5 py-2 ${
              job.status === "running"
                ? "border-primary/30 bg-primary/10"
                : "border-base-content/10 bg-base-300/40"
            }`}
          >
            <div class="flex items-start gap-2">
              <StatusIcon status={job.status} />
              <div class="min-w-0 flex-1">
                <a
                  href={job.href || "/"}
                  class="flex items-center gap-1 truncate text-xs font-medium hover:underline"
                  title={job.label}
                >
                  <TypeIcon type={job.type} />
                  <span class="truncate">{job.label}</span>
                </a>
                <p class="mt-0.5 line-clamp-2 text-[10px] leading-snug text-base-content/55">
                  {job.message}
                </p>
                {job.status === "running" && (
                  <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-base-300">
                    <div
                      class="h-full bg-primary transition-all"
                      style={{ width: `${Math.max(4, job.progress || 0)}%` }}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                class={`btn btn-ghost btn-xs btn-square hover:opacity-100 ${
                  job.status === "running"
                    ? "text-error opacity-80"
                    : "opacity-50"
                }`}
                title={job.status === "running" ? "Arrêter et retirer" : "Retirer"}
                onClick={() => {
                  void dismissJob(job.id);
                }}
              >
                {job.status === "running" ? <Ban size={12} /> : <Trash2 size={12} />}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {active.length > 0 && (
        <p class="mt-2 px-1 text-[10px] text-base-content/40">
          Album, morceau unique, clips (Veo / Seedance / Wan2GP) : tu peux changer de page.
          Pipeline Auto A→Z : reste sur le Studio.
        </p>
      )}
      {recent.length > 0 && (
        <div class="mt-2 flex justify-end px-1">
          <button
            type="button"
            class="text-[10px] text-base-content/40 hover:text-base-content"
            onClick={() => clearFinishedJobs()}
          >
            Effacer terminées
          </button>
        </div>
      )}
    </>
  );
}

function useJobs() {
  const [jobs, setJobs] = useState(() => listJobs());

  useEffect(() => {
    bootJobRunner();
    return subscribeJobs(setJobs);
  }, []);

  // Sync album distant → dock Tâches (localStorage ne traverse pas les appareils)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("project");
    if (!pid) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const { project: saved } = await api.getProject(pid);
        if (cancelled) return;
        const album = saved?.project?.album;
        if (album) mirrorAlbumJob(album, saved.id || pid);
      } catch {
        /* ignore */
      }
    };

    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const active = jobs.filter((j) => j.status === "running");
  const recent = jobs.filter((j) => j.status !== "running").slice(0, 5);
  const visible = [...active, ...recent].slice(0, 8);
  return { jobs, active, recent, visible };
}

/**
 * Panneau jobs sidebar (desktop).
 */
export function JobsDockSidebar() {
  const { active, recent, visible } = useJobs();
  if (!visible.length) return null;

  return (
    <div class="border-t border-base-content/10 p-3">
      <div class="mb-2 flex items-center justify-between gap-2 px-1">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-base-content/50">
          Tâches {active.length ? `(${active.length})` : ""}
        </p>
        {recent.length > 0 && (
          <button
            type="button"
            class="text-[10px] text-base-content/40 hover:text-base-content"
            onClick={() => clearFinishedJobs()}
          >
            Effacer
          </button>
        )}
      </div>
      <JobsList visible={visible} active={active} recent={[]} />
    </div>
  );
}

/**
 * Tiroir Tâches collé en bas d’écran (mobile) — barre compacte, déroulable.
 * Le padding du contenu est géré via --sonozz-jobs-dock (hauteur réelle de la barre).
 */
export function JobsDockMobile() {
  const { active, recent, visible } = useJobs();
  const [open, setOpen] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    if (!visible.length) setOpen(false);
  }, [visible.length]);

  useEffect(() => {
    const root = document.documentElement;
    if (!visible.length) {
      root.style.setProperty("--sonozz-jobs-dock", "0px");
      return undefined;
    }
    root.style.setProperty("--sonozz-jobs-dock", "6.5rem");
    const el = barRef.current;
    if (!el) return undefined;
    const apply = () => {
      if (open) return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.style.setProperty("--sonozz-jobs-dock", `${Math.max(72, h)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, visible.length, active.length]);

  useEffect(() => {
    return () => {
      document.documentElement.style.setProperty("--sonozz-jobs-dock", "0px");
    };
  }, []);

  if (!visible.length) return null;

  const head = active[0] || visible[0];
  const label = active.length
    ? `${active.length} en cours`
    : `${visible.length} récente${visible.length > 1 ? "s" : ""}`;

  return (
    <div class="pointer-events-none fixed inset-x-0 bottom-[var(--sonozz-now-playing,0px)] z-50 md:hidden">
      {open && (
        <button
          type="button"
          class="pointer-events-auto absolute inset-x-0 bottom-0 h-[100dvh] w-full bg-black/50"
          aria-label="Fermer les tâches"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        ref={barRef}
        class="pointer-events-auto relative border-t border-base-content/15 bg-base-200 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] safe-bottom"
      >
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left touch-manipulation active:bg-base-content/5"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300">
            {active.length ? (
              <Loader2 size={16} class="animate-spin text-primary" />
            ) : (
              <CheckCircle2 size={16} class="text-success" />
            )}
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-base-content/50">
              Tâches · {label}
            </p>
            <p class="truncate text-sm font-medium">{head?.label}</p>
            {!open && head?.message ? (
              <p class="truncate text-[11px] text-base-content/50">{head.message}</p>
            ) : null}
            {!open && active.length > 0 ? (
              <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-base-300">
                <div
                  class="h-full bg-primary transition-all"
                  style={{ width: `${Math.max(4, head?.progress || 0)}%` }}
                />
              </div>
            ) : null}
          </div>
          <span class="text-base-content/50">
            {open ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </span>
        </button>

        {open && (
          <div class="max-h-[min(55dvh,420px)] overflow-y-auto border-t border-base-content/10 px-3 pb-3 pt-2">
            <JobsList visible={visible} active={active} recent={recent} />
          </div>
        )}
      </div>
    </div>
  );
}

/** @deprecated utilise JobsDockSidebar — alias pour compat */
export default function JobsDock() {
  return <JobsDockSidebar />;
}
