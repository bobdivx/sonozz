import { useEffect, useState } from "preact/hooks";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Film,
  Zap,
  Layers,
  Share2,
} from "lucide-preact";
import {
  clearFinishedJobs,
  listJobs,
  removeJob,
  subscribeJobs,
} from "../lib/jobStore.js";
import { bootJobRunner } from "../lib/jobRunner.js";

function StatusIcon({ status }) {
  if (status === "running") return <Loader2 size={14} class="animate-spin text-primary" />;
  if (status === "done") return <CheckCircle2 size={14} class="text-success" />;
  if (status === "interrupted") return <AlertTriangle size={14} class="text-warning" />;
  return <XCircle size={14} class="text-error" />;
}

function TypeIcon({ type }) {
  if (type === "pipeline") return <Zap size={12} />;
  if (type === "step") return <Layers size={12} />;
  if (type === "publish") return <Share2 size={12} />;
  return <Film size={12} />;
}

/**
 * Panneau jobs dans la sidebar — visible sur toutes les pages.
 */
export default function JobsDock() {
  const [jobs, setJobs] = useState(() => listJobs());

  useEffect(() => {
    bootJobRunner();
    return subscribeJobs(setJobs);
  }, []);

  const active = jobs.filter((j) => j.status === "running");
  const recent = jobs.filter((j) => j.status !== "running").slice(0, 5);
  const visible = [...active, ...recent].slice(0, 8);

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
              {job.status !== "running" && (
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100"
                  title="Retirer"
                  onClick={() => removeJob(job.id)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {active.length > 0 && (
        <p class="mt-2 px-1 text-[10px] text-base-content/40">
          Clips (Veo / Seedance / Wan2GP) : tu peux naviguer. Étapes Studio / Auto :
          reste sur le Studio.
        </p>
      )}
    </div>
  );
}
