import { useEffect, useState } from "preact/hooks";
import { KeyRound, ExternalLink, CheckCircle2, XCircle, Save, PlugZap } from "lucide-preact";
import { KEY_FIELDS, loadKeys, saveKeys, keysReady } from "../lib/keys.js";
import { api } from "../lib/apiClient.js";

export default function SettingsPanel({ open, onClose, onSaved }) {
  const [keys, setKeys] = useState(loadKeys);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setKeys(loadKeys());
      setMessage("");
      setTests(null);
    }
  }, [open]);

  if (!open) return null;

  function update(id, value) {
    setKeys((prev) => ({ ...prev, [id]: value }));
  }

  function handleSave() {
    setSaving(true);
    const next = saveKeys(keys);
    setKeys(next);
    setMessage(keysReady(next) ? "Clés enregistrées localement." : "Enregistré — Gemini est encore requis pour l'auto.");
    onSaved?.(next);
    setSaving(false);
  }

  async function handleTest() {
    saveKeys(keys);
    setTesting(true);
    setMessage("");
    try {
      const { results } = await api.testKeys();
      setTests(results);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm md:items-center">
      <div
        class="absolute inset-0"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="presentation"
      />
      <section class="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-base-content/15 bg-base-100 p-5 shadow-2xl md:p-7 animate-rise">
        <header class="mb-6 flex items-start justify-between gap-4">
          <div>
            <p class="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-primary">
              <KeyRound size={14} /> Configuration
            </p>
            <h2 class="font-display mt-1 text-2xl font-bold">Clés & tokens API</h2>
            <p class="mt-1 text-sm text-base-content/60">
              Stockage local navigateur uniquement. Jamais envoyé ailleurs que vers tes APIs via ce serveur.
            </p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" onClick={onClose}>
            Fermer
          </button>
        </header>

        <div class="space-y-7">
          {KEY_FIELDS.map((group) => (
            <div key={group.group} class="space-y-3">
              <h3 class="font-display text-sm font-semibold uppercase tracking-wider text-base-content/45">
                {group.group}
              </h3>
              {group.items.map((field) => (
                <label key={field.id} class="form-control block w-full">
                  <span class="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span>
                      {field.label}
                      {field.required && <span class="text-primary"> *</span>}
                    </span>
                    {field.url && (
                      <a
                        href={field.url}
                        target="_blank"
                        rel="noreferrer"
                        class="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
                      >
                        Obtenir <ExternalLink size={12} />
                      </a>
                    )}
                  </span>
                  {field.inputType === "select" ? (
                    <select
                      class="select select-bordered w-full bg-base-200"
                      value={keys[field.id] || field.options?.[0]?.value || ""}
                      onChange={(e) => update(field.id, e.currentTarget.value)}
                    >
                      {(field.options || []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.inputType || "password"}
                      autocomplete="off"
                      class="input input-bordered w-full bg-base-200 font-mono text-sm"
                      placeholder={field.placeholder}
                      value={keys[field.id] || ""}
                      onInput={(e) => update(field.id, e.currentTarget.value)}
                    />
                  )}
                  <span class="mt-1 text-xs text-base-content/45">{field.help}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        {tests && (
          <ul class="mt-6 space-y-2 border-t border-base-content/10 pt-4">
            {Object.entries(tests).map(([name, result]) => (
              <li key={name} class="flex items-start gap-2 text-sm">
                {result.ok ? (
                  <CheckCircle2 size={16} class="mt-0.5 text-success" />
                ) : (
                  <XCircle size={16} class="mt-0.5 text-base-content/35" />
                )}
                <span>
                  <span class="font-medium capitalize">{name}</span> — {result.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {message && <p class="mt-4 text-sm text-primary">{message}</p>}

        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" class="btn btn-primary gap-2" onClick={handleSave} disabled={saving}>
            <Save size={16} />
            Enregistrer
          </button>
          <button type="button" class="btn btn-outline gap-2" onClick={handleTest} disabled={testing}>
            {testing ? <span class="loading loading-spinner loading-sm" /> : <PlugZap size={16} />}
            Tester les connexions
          </button>
        </div>
      </section>
    </div>
  );
}
