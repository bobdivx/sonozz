import { useEffect, useState } from "preact/hooks";
import { History, Trash2, FolderOpen, RefreshCw, Database } from "lucide-preact";
import { api } from "../lib/apiClient.js";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function HistoryPanel({ open, onClose, onLoad, currentId }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dbInfo, setDbInfo] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [{ projects: list }, db] = await Promise.all([
        api.listProjects(),
        api.testDb().catch(() => null),
      ]);
      setProjects(list || []);
      setDbInfo(db);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  async function handleDelete(id) {
    if (!confirm("Supprimer ce projet de l'historique Turso ?")) return;
    await api.deleteProject(id);
    refresh();
  }

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm md:items-center">
      <div class="absolute inset-0" onClick={onClose} role="presentation" />
      <section class="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col border border-base-content/15 bg-base-100 shadow-2xl animate-rise">
        <header class="flex items-start justify-between gap-3 border-b border-base-content/10 p-5">
          <div>
            <p class="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-primary">
              <History size={14} /> Historique Turso
            </p>
            <h2 class="font-display mt-1 text-2xl font-bold">Créations sauvegardées</h2>
            {dbInfo && (
              <p class="mt-1 inline-flex items-center gap-1 text-xs text-base-content/50">
                <Database size={12} /> {dbInfo.projects} projet(s) · DB connectée
              </p>
            )}
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
              <RefreshCw size={14} class={loading ? "animate-spin" : ""} />
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={onClose}>
              Fermer
            </button>
          </div>
        </header>

        <div class="overflow-y-auto p-3">
          {error && <p class="m-2 text-sm text-error">{error}</p>}
          {!error && !loading && projects.length === 0 && (
            <p class="p-4 text-sm text-base-content/55">Aucun projet sauvegardé pour l’instant.</p>
          )}
          <ul class="space-y-2">
            {projects.map((p) => (
              <li
                key={p.id}
                class={`flex items-stretch gap-1 border ${
                  currentId === p.id
                    ? "border-primary bg-primary/10"
                    : "border-base-content/10 bg-base-200/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onLoad?.(p.id)}
                  class="min-w-0 flex-1 px-3 py-3 text-left hover:bg-base-content/5"
                >
                  <p class="truncate font-display font-semibold">{p.title}</p>
                  <p class="text-xs text-base-content/50">
                    {p.status} · {formatDate(p.updatedAt)}
                  </p>
                </button>
                <div class="flex flex-col justify-center gap-1 pr-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    title="Ouvrir"
                    onClick={() => onLoad?.(p.id)}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    title="Supprimer"
                    onClick={() => handleDelete(p.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
