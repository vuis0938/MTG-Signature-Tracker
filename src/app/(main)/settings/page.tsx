"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/user";
import { LogOut, Download, Trash2, User, Info, Database } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const currentUser = getCurrentUser();

  const [loggingOut, setLoggingOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // ─── 退出登录 ───
  async function handleLogout() {
    setLoggingOut(true);
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch {
      setToast({ message: "退出失败，请重试", type: "error" });
    } finally {
      setLoggingOut(false);
    }
  }

  // ─── 导出数据 ───
  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/export-data");
      const data = await res.json();

      if (data.success) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mtg-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setToast({
          message: `✅ 导出成功：${data.deckCount} 个套牌，${data.cardCount} 张卡牌`,
          type: "success",
        });
      } else {
        setToast({ message: "导出失败", type: "error" });
      }
    } catch {
      setToast({ message: "导出失败", type: "error" });
    } finally {
      setExporting(false);
    }
  }

  // ─── 补全模糊匹配缓存 ───
  async function handleBackfill() {
    setBackfilling(true);
    try {
      const res = await fetch("/api/backfill-cache", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (data.skipped === data.total) {
          setToast({ message: `✅ 所有 ${data.total} 张卡牌已缓存，无需补全`, type: "success" });
        } else {
          setToast({ message: `✅ 补全完成：${data.cached} 张新增，${data.skipped} 张已存在` + (data.failed > 0 ? `，${data.failed} 张失败` : ""), type: "success" });
        }
      } else {
        setToast({ message: data.error || "补全失败", type: "error" });
      }
    } catch {
      setToast({ message: "补全失败", type: "error" });
    } finally {
      setBackfilling(false);
    }
  }

  // ─── 清除所有数据 ───
  async function handleClearData() {
    if (!confirm("确定要清除所有套牌和卡牌数据吗？此操作不可撤销！")) return;
    if (!confirm("再次确认：所有数据将被永久删除。")) return;

    setClearing(true);
    try {
      const res = await fetch("/api/clear-data", { method: "DELETE" });
      const data = await res.json();

      if (data.success) {
        setToast({ message: "✅ 所有数据已清除", type: "success" });
      } else {
        setToast({ message: data.error || "清除失败", type: "error" });
      }
    } catch {
      setToast({ message: "清除失败", type: "error" });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="text-muted-foreground">数据管理与偏好配置</p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`p-3 rounded-lg text-sm ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-3 text-current opacity-50 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 账户信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            账户信息
          </CardTitle>
          <CardDescription>当前登录的账户</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{currentUser}</p>
              <p className="text-xs text-muted-foreground">当前用户名</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              {loggingOut ? "退出中..." : "退出登录"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 数据管理 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" />
            数据管理
          </CardTitle>
          <CardDescription>备份或清除你的套牌数据</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">导出数据</p>
              <p className="text-xs text-muted-foreground">将所有套牌和卡牌导出为 JSON 文件</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "导出中..." : "导出"}
            </Button>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <p className="text-sm font-medium text-destructive">清除所有数据</p>
              <p className="text-xs text-muted-foreground">永久删除所有套牌和卡牌，不可恢复</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearData}
              disabled={clearing}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {clearing ? "清除中..." : "清除"}
            </Button>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <p className="text-sm font-medium">补全模糊匹配缓存</p>
              <p className="text-xs text-muted-foreground">为所有历史套牌预填充缓存，加速模糊匹配</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackfill}
              disabled={backfilling}
            >
              <Database className="h-4 w-4 mr-2" />
              {backfilling ? "补全中..." : "补全缓存"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 关于 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            关于
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">应用名称</span>
              <span>MTG 签绘管家</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">版本</span>
              <span>v0.2.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">数据来源</span>
              <a
                href="https://scryfall.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Scryfall
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">活动信息</span>
              <a
                href="https://mtgartistconnection.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                MTG Artist Connection
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}