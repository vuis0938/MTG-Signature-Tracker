"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/toast-context";
import { MessageSquare, Check, Trash2, Loader2, CheckCheck, Bug, Lightbulb, HelpCircle, AlertTriangle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Feedback {
  id: string;
  user_name: string;
  category: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

const categoryMeta: Record<string, { label: string; icon: typeof Bug; color: string }> = {
  bug: { label: "Bug 反馈", icon: Bug, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  suggestion: { label: "功能建议", icon: Lightbulb, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  other: { label: "其他", icon: HelpCircle, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
  error: { label: "运行时错误", icon: AlertTriangle, color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
};

export default function FeedbackPage() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast: showToast } = useToast();

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feedback?filter=${filter}`);
      const data = await res.json();
      if (data.success) {
        setFeedback(data.feedback);
      } else {
        showToast(data.error || "加载失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setLoading(false);
    }
  }, [filter, showToast]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  // 标记单条已读
  async function handleMarkRead(id: string) {
    setActionLoading(`read:${id}`);
    try {
      const res = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback((prev) =>
          prev.map((f) => (f.id === id ? { ...f, is_read: true } : f)),
        );
      }
    } catch {
      showToast("操作失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  // 全部标记已读
  async function handleMarkAllRead() {
    const unreadIds = feedback.filter((f) => !f.is_read).map((f) => f.id);
    if (unreadIds.length === 0) return;

    setActionLoading("all-read");
    try {
      const res = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unreadIds }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback((prev) => prev.map((f) => ({ ...f, is_read: true })));
        showToast(`已标记 ${unreadIds.length} 条为已读`, "success");
      }
    } catch {
      showToast("操作失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  // 删除反馈
  async function handleDelete(id: string, content: string) {
    const preview = content.length > 20 ? content.slice(0, 20) + "..." : content;
    if (!confirm(`确定删除这条反馈？「${preview}」此操作不可撤销。`)) return;

    setActionLoading(`delete:${id}`);
    try {
      const res = await fetch(`/api/feedback?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setFeedback((prev) => prev.filter((f) => f.id !== id));
        showToast("已删除", "success");
      }
    } catch {
      showToast("删除失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  // 一键复制反馈内容
  async function handleCopy(f: Feedback) {
    const meta = categoryMeta[f.category] || categoryMeta.other;
    const text = `[${meta.label}] ${f.user_name} · ${formatDateTime(f.created_at)}\n\n${f.content}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(f.id);
      showToast("已复制到剪贴板", "success");
      setTimeout(() => setCopiedId((current) => (current === f.id ? null : current)), 2000);
    } catch {
      showToast("复制失败，请手动复制", "error");
    }
  }

  function formatDateTime(date: string) {
    return new Date(date).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const unreadCount = feedback.filter((f) => !f.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            反馈管理
            {unreadCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500 text-white font-medium">
                {unreadCount} 未读
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            查看用户提交的 Bug 反馈与建议
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "px-3 py-1.5 text-xs transition-colors",
                filter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              全部
            </button>
            <button
              onClick={() => setFilter("unread")}
              className={cn(
                "px-3 py-1.5 text-xs transition-colors",
                filter === "unread"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              未读
            </button>
          </div>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkAllRead}
              disabled={actionLoading === "all-read"}
            >
              {actionLoading === "all-read" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCheck className="h-4 w-4 mr-1" />
              )}
              全部已读
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : feedback.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
            {filter === "unread" ? "暂无未读反馈" : "暂无反馈"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {feedback.map((f) => {
            const meta = categoryMeta[f.category] || categoryMeta.other;
            const Icon = meta.icon;
            return (
              <Card
                key={f.id}
                className={cn(!f.is_read && "border-primary/40 bg-primary/[0.02]")}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={cn("text-xs px-1.5 py-0.5 rounded flex items-center gap-1", meta.color)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        {!f.is_read && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
                            未读
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {f.user_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(f.created_at)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">{f.content}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(f)}
                        disabled={!!actionLoading}
                        title="复制反馈内容"
                      >
                        {copiedId === f.id ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {!f.is_read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleMarkRead(f.id)}
                          disabled={!!actionLoading}
                          title="标记已读"
                        >
                          {actionLoading === `read:${f.id}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(f.id, f.content)}
                        disabled={!!actionLoading}
                        className="text-red-600 hover:text-red-700"
                        title="删除"
                      >
                        {actionLoading === `delete:${f.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
