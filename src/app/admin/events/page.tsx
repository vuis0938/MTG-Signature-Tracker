"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/toast-context";
import { Plus, Trash2, Edit3, Archive, ArchiveRestore, Loader2, Calendar, MapPin } from "lucide-react";

interface CustomEvent {
  id: string;
  name: string;
  date: string;
  end_date: string | null;
  location: string | null;
  artists: string[];
  archived: boolean;
  created_at: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<CustomEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast: showToast } = useToast();

  // 表单状态
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [artistsText, setArtistsText] = useState("");

  async function loadEvents() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/events?archived=1");
      const data = await res.json();
      if (data.success) {
        setEvents(data.events);
      }
    } catch {
      showToast("加载失败", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setName("");
    setDate("");
    setEndDate("");
    setLocation("");
    setArtistsText("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(event: CustomEvent) {
    setEditingId(event.id);
    setName(event.name);
    setDate(event.date);
    setEndDate(event.end_date || "");
    setLocation(event.location || "");
    setArtistsText(event.artists.join("\n"));
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !date) {
      showToast("活动名称和日期为必填项", "error");
      return;
    }

    const artists = artistsText
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean);

    setActionLoading("form");
    try {
      const isEditing = !!editingId;
      const url = "/api/admin/events";
      const method = isEditing ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name,
        date,
        endDate: endDate || undefined,
        location: location || undefined,
        artists,
      };
      if (isEditing) body.id = editingId;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        showToast(isEditing ? "活动已更新" : "活动已创建", "success");
        resetForm();
        await loadEvents();
      } else {
        showToast(data.error || "操作失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleArchive(id: string, archived: boolean) {
    setActionLoading(`archive:${id}`);
    try {
      const res = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, archived: !archived }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(archived ? "已归档" : "已取消归档", "success");
        await loadEvents();
      }
    } catch {
      showToast("操作失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除活动「${name}」？此操作不可撤销。`)) return;
    setActionLoading(`delete:${id}`);
    try {
      const res = await fetch(`/api/admin/events?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast("已删除", "success");
        await loadEvents();
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

  const activeEvents = events.filter((e) => !e.archived);
  const archivedEvents = events.filter((e) => e.archived);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">活动管理</h1>
          <p className="text-muted-foreground text-sm">管理自定义活动 · {activeEvents.length} 个进行中</p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            添加活动
          </Button>
        )}
      </div>

      {/* 表单 */}
      {showForm && (
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">活动名称 *</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：Gen Con 2026" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">地点</Label>
                  <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如：印第安纳波利斯" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">开始日期 *</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">结束日期</Label>
                  <Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="artists">画家名单（每行一个）</Label>
                <Textarea
                  id="artists"
                  value={artistsText}
                  onChange={(e) => setArtistsText(e.target.value)}
                  placeholder={"如：\nDan Scott\nMagali Villeneuve\nSeb McKinnon"}
                  rows={6}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={actionLoading === "form"}>
                  {actionLoading === "form" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {editingId ? "保存修改" : "创建活动"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 活动列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            暂无自定义活动，点击「添加活动」创建
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* 进行中的活动 */}
          {activeEvents.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">进行中</h3>
              {activeEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onEdit={() => startEdit(event)}
                  onArchive={() => handleArchive(event.id, event.archived)}
                  onDelete={() => handleDelete(event.id, event.name)}
                  actionLoading={actionLoading}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}

          {/* 已归档活动 */}
          {archivedEvents.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">已归档</h3>
              {archivedEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onEdit={() => startEdit(event)}
                  onArchive={() => handleArchive(event.id, event.archived)}
                  onDelete={() => handleDelete(event.id, event.name)}
                  actionLoading={actionLoading}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({
  event,
  onEdit,
  onArchive,
  onDelete,
  actionLoading,
  formatDate,
}: {
  event: CustomEvent;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  actionLoading: string | null;
  formatDate: (d: string | null) => string;
}) {
  return (
    <Card className={event.archived ? "opacity-60" : ""}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-sm">{event.name}</h3>
              {event.archived && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">已归档</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(event.date)}{event.end_date ? ` ~ ${formatDate(event.end_date)}` : ""}
              </span>
              {event.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {event.location}
                </span>
              )}
            </div>
            {event.artists.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {event.artists.map((a) => (
                  <span key={a} className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onEdit} disabled={!!actionLoading}>
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onArchive}
              disabled={!!actionLoading}
              title={event.archived ? "取消归档" : "归档"}
            >
              {actionLoading === `archive:${event.id}` ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : event.archived ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={!!actionLoading}
              className="text-red-600 hover:text-red-700"
            >
              {actionLoading === `delete:${event.id}` ? (
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
}
