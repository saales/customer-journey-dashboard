import type { ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, children }: ConfirmDialogProps) {
  return (
    <div className="confirm-overlay">
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <h3 id="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-message">{message}</p>
        {children}
        <div className="confirm-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>Annulla</button>
          <button type="button" className="button-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
