"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast-context";
import { Search, Trash2, Loader2, Database, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

interface CacheItem {
  card_name: string;
  created_at: string;
  updated_at: string;
}

interface CacheStats {
  totalCached: number;
  oldestCreatedAt: string | null;
  newestUpdatedAt: string | null;
}

export default function CachePage() {
  const [items, setItems] = useState<CacheItem[]>([]);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const { toast: showToast } = useToast();

  async function loadCache(searchVal?: string, pageVal?: number) {
    setLoading(true);
    const s = searchVal !== undefined ? searchVal : search;
    const p = pageVal !== undefined ? pageVal : page;
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: "20" });
      if (s) params.set("search", s);
      const res = await fetch(`/api/admin/cache?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
        setStats(data.stats);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      showToast("加载失败", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCache("", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadCache(search, 1);
  }

  async function handleDelete(cardName: string) {
    if (!confirm(`确定删除「${cardName}」的缓存？下次匹配时会重新从 Scryfall 拉取。`)) return;
    setActionLoading(`delete:${cardName}`);
    try {
      const res = await fetch(`/api/admin/cache?cardName=${encodeURIComponent(cardName)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, "success");
        await loadCache();
      } else {
        showToast(data.error || "删除失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleClearAll() {
    setActionLoading("clearAll");
    try {
      const res = await fetch("/api/admin/cache?all=1", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, "success");
        setConfirmClearAll(false);
        await loadCache();
      } else {
        showToast(data.error || "清空失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(date: string | null) {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">缓存管理</h1>
          <p className="text-muted-foreground text-sm">Scryfall 印刷版本缓存</p>
        </div>
        {stats && stats.totalCached > 0 && !confirmClearAll && (
          <Button variant="outline" size="sm" onClick={() => setConfirmClearAll(true)} className="text-red-600 hover:text-red-700">
            <Trash2 className="h-4 w-4 mr-1" />
            清空全部
          </Button>
        )}
      </div>

      {/* 清空确认 */}
      {confirmClearAll && (
        <Card className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  确定要清空全部 {stats?.totalCached || 0} 条缓存吗？
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  清空后用户下次匹配时会重新从 Scryfall 拉取所有印刷版本，可能导致短暂的匹配变慢。
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={handleClearAll} disabled={actionLoading === "clearAll"}>
                  {actionLoading === "clearAll" ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认清空"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmClearAll(false)}>
                  取消
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">缓存总数</span>
                <Database className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold">{stats.totalCached}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <span className="text-sm text-muted-foreground">最早缓存</span>
              <div className="text-base font-medium mt-1">{formatDate(stats.oldestCreatedAt)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <span className="text-sm text-muted-foreground">最近更新</span>
              <div className="text-base font-medium mt-1">{formatDate(stats.newestUpdatedAt)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 搜索 */}
      <form onSubmit={handleSearch} className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索卡牌名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </form>

      {/* 缓存列表 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              加载中...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {search ? "未找到匹配的缓存" : "暂无缓存数据"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">卡牌名称</th>
                    <th className="px-4 py-3 font-medium">创建时间</th>
                    <th className="px-4 py-3 font-medium">更新时间</th>
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.card_name} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{item.card_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(item.created_at)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(item.updated_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(item.card_name)}
                          disabled={actionLoading === `delete:${item.card_name}`}
                          className="text-red-600 hover:text-red-700"
                        >
                          {actionLoading === `delete:${item.card_name}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { const p = Math.max(1, page - 1); setPage(p); loadCache(undefined, p); }}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}（共 {total} 条）</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); loadCache(undefined, p); }}
            disabled={page >= totalPages || loading}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
