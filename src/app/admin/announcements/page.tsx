"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/toast-context";
import { Plus, Trash2, Edit3, Loader2, Megaphone, Eye, EyeOff } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

const typeLabels: Record<string, { label: string; color: string }> = {
  info: { label: "通知", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  warning: { label: "警告", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  maintenance: { label: "维护", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast: showToast } = useToast();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("info");
  const [active, setActive] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");

  async function loadAnnouncements() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      const data = await res.json();
      if (data.success) {
        setAnnouncements(data.announcements);
      }
    } catch {
      showToast("加载失败", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnnouncements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setTitle("");
    setContent("");
    setType("info");
    setActive(true);
    setExpiresAt("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(a: Announcement) {
    setEditingId(a.id);
    setTitle(a.title);
    setContent(a.content);
    setType(a.type);
    setActive(a.active);
    setExpiresAt(a.expires_at ? a.expires_at.split("T")[0] : "");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      showToast("标题和内容为必填项", "error");
      return;
    }

    setActionLoading("form");
    try {
      const isEditing = !!editingId;
      const body: Record<string, unknown> = {
        title,
        content,
        type,
        active,
        expiresAt: expiresAt || null,
      };
      if (isEditing) body.id = editingId;

      const res = await fetch("/api/admin/announcements", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        showToast(isEditing ? "公告已更新" : "公告已发布", "success");
        resetForm();
        await loadAnnouncements();
      } else {
        showToast(data.error || "操作失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    setActionLoading(`toggle:${id}`);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !currentActive }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(!currentActive ? "已启用" : "已停用", "success");
        await loadAnnouncements();
      }
    } catch {
      showToast("操作失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`确定删除公告「${title}」？此操作不可撤销。`)) return;
    setActionLoading(`delete:${id}`);
    try {
      const res = await fetch(`/api/admin/announcements?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast("已删除", "success");
        await loadAnnouncements();
      }
    } catch {
      showToast("删除失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(date: string | null) {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("zh-CN");
  }

  const activeCount = announcements.filter((a) => a.active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">系统公告</h1>
          <p className="text-muted-foreground text-sm">
            向用户推送通知 · {activeCount} 个启用中 / {announcements.length} 个总计
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            发布公告
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="title">标题 *</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：系统维护通知" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">类型</Label>
                  <select
                    id="type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="info">通知（蓝色）</option>
                    <option value="warning">警告（黄色）</option>
                    <option value="maintenance">维护（红色）</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">内容 *</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="公告正文内容..."
                  rows={3}
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expiresAt">过期日期（可选）</Label>
                  <Input id="expiresAt" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    立即启用
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={actionLoading === "form"}>
                  {actionLoading === "form" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {editingId ? "保存修改" : "发布公告"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
            暂无公告，点击「发布公告」创建
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => {
            const typeMeta = typeLabels[a.type] || typeLabels.info;
            return (
              <Card key={a.id} className={!a.active ? "opacity-60" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-sm">{a.title}</h3>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${typeMeta.color}`}>
                          {typeMeta.label}
                        </span>
                        {!a.active && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            已停用
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{a.content}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>创建：{formatDate(a.created_at)}</span>
                        <span>更新：{formatDate(a.updated_at)}</span>
                        {a.expires_at && <span>过期：{formatDate(a.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(a)} disabled={!!actionLoading}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(a.id, a.active)}
                        disabled={!!actionLoading}
                        title={a.active ? "停用" : "启用"}
                      >
                        {actionLoading === `toggle:${a.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : a.active ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(a.id, a.title)}
                        disabled={!!actionLoading}
                        className="text-red-600 hover:text-red-700"
                      >
                        {actionLoading === `delete:${a.id}` ? (
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
