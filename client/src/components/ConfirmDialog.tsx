import { useEffect, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-overlay">
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <h3 id="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-message">{message}</p>
        {children}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="button-secondary" onClick={onCancel}>Annulla</button>
          <button ref={confirmRef} type="button" className="button-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
