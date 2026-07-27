"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// ─── 类型 ─────────────────────────────────────────────────

export interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error";
  timestamp: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  /** 弹出 toast，返回 id 用于外部关闭 */
  toast: (message: string, type: "success" | "error") => string;
  /** 关闭指定 toast */
  dismiss: (id: string) => void;
}

// ─── Context ──────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: "success" | "error") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);

    // 5 秒后自动消失
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}