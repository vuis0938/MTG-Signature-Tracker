"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/toast-context";
import { Plus, Trash2, Search, Loader2, ArrowRight } from "lucide-react";

interface ArtistAlias {
  id: string;
  alias: string;
  canonical_name: string;
  created_at: string;
}

export default function ArtistsPage() {
  const [aliases, setAliases] = useState<ArtistAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast: showToast } = useToast();

  // 表单
  const [alias, setAlias] = useState("");
  const [canonicalName, setCanonicalName] = useState("");

  async function loadAliases(searchVal?: string) {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchVal) params.set("search", searchVal);
    try {
      const res = await fetch(`/api/admin/artists?${params}`);
      const data = await res.json();
      if (data.success) {
        setAliases(data.aliases);
      }
    } catch {
      showToast("加载失败", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAliases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    loadAliases(search);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!alias || !canonicalName) {
      showToast("别名和标准名称为必填项", "error");
      return;
    }

    setActionLoading("add");
    try {
      const res = await fetch("/api/admin/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: alias.trim(), canonicalName: canonicalName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("别名已添加", "success");
        setAlias("");
        setCanonicalName("");
        await loadAliases(search);
      } else {
        showToast(data.error || "添加失败", "error");
      }
    } catch {
      showToast("网络错误", "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string, aliasName: string) {
    if (!confirm(`确定删除别名「${aliasName}」？`)) return;
    setActionLoading(`delete:${id}`);
    try {
      const res = await fetch(`/api/admin/artists?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast("已删除", "success");
        await loadAliases(search);
      }
    } catch {
      showToast("删除失败", "error");
    } finally {
      setActionLoading(null);
    }
  }

  // 按标准名称分组
  const grouped = aliases.reduce((acc, a) => {
    if (!acc[a.canonical_name]) acc[a.canonical_name] = [];
    acc[a.canonical_name].push(a);
    return acc;
  }, {} as Record<string, ArtistAlias[]>);

  const canonicalNames = Object.keys(grouped).sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">画家别名管理</h1>
        <p className="text-muted-foreground text-sm">
          管理画家名称映射 · 共 {aliases.length} 条别名，覆盖 {canonicalNames.length} 位画家
        </p>
      </div>

      {/* 添加表单 */}
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row items-end gap-3">
            <div className="flex-1 space-y-2 w-full">
              <Label htmlFor="alias">别名（活动名单中的写法）</Label>
              <Input
                id="alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="如：Dan Scott"
              />
            </div>
            <div className="flex-1 space-y-2 w-full">
              <Label htmlFor="canonicalName">标准名称（卡牌上的名字）</Label>
              <Input
                id="canonicalName"
                value={canonicalName}
                onChange={(e) => setCanonicalName(e.target.value)}
                placeholder="如：Dan Murayama Scott"
              />
            </div>
            <Button type="submit" disabled={actionLoading === "add"}>
              {actionLoading === "add" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              添加
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 搜索 */}
      <form onSubmit={handleSearch} className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索别名或标准名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </form>

      {/* 别名列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : aliases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            {search ? "未找到匹配的别名" : "暂无别名映射，添加后可提升匹配精度"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {canonicalNames.map((canonical) => (
            <Card key={canonical}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-medium text-sm">{canonical}</h3>
                  <span className="text-xs text-muted-foreground">
                    ({grouped[canonical].length} 个别名)
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {grouped[canonical].map((a) => (
                    <div
                      key={a.id}
                      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-muted text-sm group"
                    >
                      <span className="text-muted-foreground">{a.alias}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{a.canonical_name}</span>
                      <button
                        onClick={() => handleDelete(a.id, a.alias)}
                        disabled={actionLoading === `delete:${a.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700"
                      >
                        {actionLoading === `delete:${a.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
