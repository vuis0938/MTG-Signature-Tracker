"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/toast-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDisplayMode } from "@/lib/display-mode";
import { useDeckLayout, type DeckLayout } from "@/lib/deck-layout";
import { useUser } from "@/lib/user-context";
import { LogOut, Download, Trash2, User, Info, Layout, Columns, List, Layers, Rows3, PanelsTopLeft } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const currentUser = useUser();

  const [loggingOut, setLoggingOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { toast: showToast } = useToast();
  const { mode: displayMode, toggle: toggleDisplayMode } = useDisplayMode();
  const { layout: deckLayout, setLayout: setDeckLayout } = useDeckLayout();

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
      showToast("退出失败，请重试", "error");
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
        showToast(
          `✅ 导出成功：${data.deckCount} 个套牌，${data.cardCount} 张卡牌`,
          "success",
        );
      } else {
        showToast("导出失败", "error");
      }
    } catch {
      showToast("导出失败", "error");
    } finally {
      setExporting(false);
    }
  }

  // ─── 清除所有数据 ───
  async function handleClearData() {
    if (!confirm("确定清除所有数据吗？此操作不可撤销")) return;

    setClearing(true);
    try {
      const res = await fetch("/api/clear-data", { method: "DELETE" });
      const data = await res.json();

      if (data.success) {
        showToast("✅ 所有数据已清除", "success");
      } else {
        showToast(data.error || "清除失败", "error");
      }
    } catch {
      showToast("清除失败", "error");
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

      {/* 账户信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            账户信息
          </CardTitle>
          <CardDescription>当前登录账户</CardDescription>
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

      {/* 显示偏好 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layout className="h-4 w-4" />
            显示偏好
          </CardTitle>
          <CardDescription>套牌管理界面卡牌显示方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">复数卡牌显示</p>
              <p className="text-xs text-muted-foreground">
                {displayMode === "individual"
                  ? "当前：独立显示 — 每张卡牌单独显示"
                  : "当前：合并显示 — 相同卡牌合并为 ×N 样式"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleDisplayMode}
            >
              {displayMode === "individual" ? <Rows3 className="h-4 w-4 mr-2" /> : <Layers className="h-4 w-4 mr-2" />}
              {displayMode === "individual" ? "独立显示" : "合并显示"}
            </Button>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <p className="text-sm font-medium">套牌排版方式</p>
              <p className="text-xs text-muted-foreground">
                {deckLayout === "default"
                  ? "当前：默认 — 宽松网格"
                  : deckLayout === "compact"
                  ? "当前：紧凑 — 自适应网格"
                  : "当前：文本 — 高密度文本"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next: DeckLayout = deckLayout === "default" ? "compact" : deckLayout === "compact" ? "list" : "default";
                setDeckLayout(next);
              }}
            >
              {deckLayout === "default" ? <PanelsTopLeft className="h-4 w-4 mr-2" /> : deckLayout === "compact" ? <Columns className="h-4 w-4 mr-2" /> : <List className="h-4 w-4 mr-2" />}
              {deckLayout === "default" ? "默认" : deckLayout === "compact" ? "紧凑" : "文本"}
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
          <CardDescription>备份与清除数据</CardDescription>
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
              <span>v1.0.0</span>
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
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">活动信息</span>
              <div className="flex flex-col items-end gap-0.5">
                <a
                  href="https://mtgartistconnection.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  MTG Artist Connection
                </a>
                <a
                  href="https://mountainmagesigs.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Mountain Mage Signatures
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}