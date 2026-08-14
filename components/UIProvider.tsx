"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { id: number; message: string; type: "success" | "error" | "info" };
type ConfirmState = { message: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void } | null;

type UIContextType = {
  toast: (message: string, type?: Toast["type"]) => void;
  confirm: (message: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
};

const UIContext = createContext<UIContextType | null>(null);

// Replaces window.alert()/window.confirm() with something that actually
// matches the rest of the app's styling instead of a jarring native browser
// popup. Mounted once at the authenticated-app layout level (see
// app/(app)/layout.tsx), so any page underneath can just call useUI().
export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const nextId = useRef(0);

  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const confirm = useCallback((message: string, opts?: { confirmLabel?: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ message, confirmLabel: opts?.confirmLabel ?? "Confirm", danger: opts?.danger ?? false, resolve });
    });
  }, []);

  function respond(value: boolean) {
    confirmState?.resolve(value);
    setConfirmState(null);
  }

  return (
    <UIContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>

      {confirmState && (
        <div className="modal-overlay" onClick={() => respond(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 18px" }}>{confirmState.message}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="ghost" onClick={() => respond(false)}>Cancel</button>
              <button className={confirmState.danger ? "danger" : "primary"} onClick={() => respond(true)}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}
