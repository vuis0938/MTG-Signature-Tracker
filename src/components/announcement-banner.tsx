"use client";

import { useState } from "react";
import { X, Info, AlertTriangle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnnouncements } from "@/lib/swr-hooks";

const typeConfig: Record<string, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-200" },
  warning: { icon: AlertTriangle, className: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200" },
  maintenance: { icon: Wrench, className: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/30 dark:border-red-900 dark:text-red-200" },
};

export function AnnouncementBanner() {
  const { announcements } = useAnnouncements();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((a) => {
        const config = typeConfig[a.type] || typeConfig.info;
        const Icon = config.icon;
        return (
          <div
            key={a.id}
            className={cn("flex items-start gap-3 px-4 py-2.5 rounded-lg border text-sm", config.className)}
          >
            <Icon className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">{a.title}</span>
              {a.content && <span className="ml-2 opacity-90">{a.content}</span>}
            </div>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
