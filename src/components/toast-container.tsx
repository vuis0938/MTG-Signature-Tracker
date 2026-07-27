"use client";

import { useToast } from "@/lib/toast-context";

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg animate-in slide-in-from-right-full ${
            t.type === "success"
              ? "bg-green-50 text-green-800 border-green-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-current opacity-50 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}