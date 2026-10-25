/*
 * PURPOSE: Generic modal overlay with escape-to-close and click-outside-to-close
 *
 * CONSUMERS: settings/SettingsModal.tsx
 */

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 className="text-ui-lg font-semibold">{title}</h2>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
