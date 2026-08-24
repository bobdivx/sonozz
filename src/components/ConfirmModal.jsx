import { X } from "lucide-preact";

/**
 * Modal de confirmation DaisyUI réutilisable
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onConfirm: () => void,
 *   title: string,
 *   message: string,
 *   confirmText?: string,
 *   cancelText?: string,
 *   confirmClass?: string
 * }} props
 */
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = "Confirmer",
  message = "Es-tu sûr de vouloir continuer ?",
  confirmText = "Confirmer",
  cancelText = "Annuler",
  confirmClass = "btn-primary",
}) {
  if (!open) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-rise">
      <div class="relative mx-4 w-full max-w-md rounded-3xl border border-base-content/10 bg-base-200 p-6 shadow-2xl">
        <button
          type="button"
          class="btn btn-ghost btn-circle btn-sm absolute right-4 top-4"
          onClick={onClose}
          aria-label="Fermer"
        >
          <X size={18} />
        </button>

        <h2 class="font-display text-2xl font-bold">{title}</h2>
        <p class="mt-3 whitespace-pre-line text-sm text-base-content/70">
          {message}
        </p>

        <div class="mt-6 flex gap-2">
          <button type="button" class="btn btn-ghost flex-1" onClick={onClose}>
            {cancelText}
          </button>
          <button type="button" class={`btn ${confirmClass} flex-1`} onClick={handleConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
