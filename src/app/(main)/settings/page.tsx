"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/toast-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDisplayMode } from "@/lib/display-mode";
import { useDeckLayout, type DeckLayout } from "@/lib/deck-layout";
import { useThemeColor } from "@/lib/use-theme-color";
import { useUser } from "@/lib/user-context";
import { LogOut, Download, Trash2, User, Info, Layout, Columns, List, Layers, Rows3, PanelsTopLeft, Palette, KeyRound } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { userName: currentUser, isAdmin } = useUser();

  const [loggingOut, setLoggingOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState("");
  const { toast: showToast } = useToast();
  const { mode: displayMode, toggle: toggleDisplayMode } = useDisplayMode();
  const { layout: deckLayout, setLayout: setDeckLayout } = useDeckLayout();
  const { themeId, toggleTheme } = useThemeColor();

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
          `导出成功：${data.deckCount} 个套牌，${data.cardCount} 张卡牌`,
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
        showToast("所有数据已清除", "success");
      } else {
        showToast(data.error || "清除失败", "error");
      }
    } catch {
      showToast("清除失败", "error");
    } finally {
      setClearing(false);
    }
  }

  // ─── 修改密码 ───
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError("");
    setPwdSuccess("");

    if (newPwd !== confirmPwd) {
      setPwdError("两次输入的新密码不一致");
      return;
    }

    setChangingPwd(true);

    try {
      const res = await fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });

      const data = await res.json();
      if (data.success) {
        setPwdSuccess("密码修改成功");
        setOldPwd("");
        setNewPwd("");
        setConfirmPwd("");
        setShowPwdForm(false);
      } else {
        setPwdError(data.error || "修改失败");
      }
    } catch {
      setPwdError("网络错误，请重试");
    } finally {
      setChangingPwd(false);
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
          <CardDescription>当前登录账户与安全设置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{currentUser}</p>
                {isAdmin && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-medium">
                    管理员
                  </span>
                )}
              </div>
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

          {/* 修改密码 */}
          <div className="border-t pt-3">
            {pwdSuccess && !showPwdForm && (
              <p className="text-sm text-green-600 mb-3">{pwdSuccess}</p>
            )}
            {!showPwdForm ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowPwdForm(true); setPwdSuccess(""); setPwdError(""); }}
              >
                <KeyRound className="h-4 w-4 mr-2" />
                修改密码
              </Button>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="oldPwd">旧密码</Label>
                  <Input
                    id="oldPwd"
                    type="password"
                    placeholder="请输入当前密码"
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPwd">新密码</Label>
                  <Input
                    id="newPwd"
                    type="password"
                    placeholder="请输入新密码"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPwd">确认新密码</Label>
                  <Input
                    id="confirmPwd"
                    type="password"
                    placeholder="请再次输入新密码"
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    required
                  />
                </div>
                {pwdError && (
                  <p className="text-sm text-destructive">{pwdError}</p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" variant="outline" size="sm" disabled={changingPwd}>
                    {changingPwd ? "修改中..." : "确认修改"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowPwdForm(false);
                      setOldPwd("");
                      setNewPwd("");
                      setConfirmPwd("");
                      setPwdError("");
                    }}
                  >
                    取消
                  </Button>
                </div>
              </form>
            )}
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
          <CardDescription>自定义卡牌展示方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">复数卡牌显示</p>
              <p className="text-xs text-muted-foreground">
                {displayMode === "individual"
                  ? "独立显示 — 每张卡牌单独显示"
                  : "合并显示 — 相同卡牌合并为 ×N 样式"}
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
                  ? "默认 — 宽松格式"
                  : deckLayout === "compact"
                  ? "紧凑 — 紧凑格式"
                  : "文本 — 纯文字格式"}
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
              {deckLayout === "default" ? "默认模式" : deckLayout === "compact" ? "紧凑模式" : "文本模式"}
            </Button>
          </div>

          {/* 主题色切换 — 暂时隐藏，后续可调出
          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <p className="text-sm font-medium">主题色</p>
              <p className="text-xs text-muted-foreground">
                {"当前：" + (themeId === "ocean" ? "海蓝" : themeId === "slate" ? "石板蓝" : "靛蓝")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleTheme}
            >
              <Palette className="h-4 w-4 mr-2" />
              {themeId === "ocean" ? "海蓝" : themeId === "slate" ? "石板蓝" : "靛蓝"}
            </Button>
          </div>
          */}
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
              <p className="text-sm font-medium">清除所有数据</p>
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
                className="text-foreground underline"
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
                  className="text-foreground underline"
                >
                  MTG Artist Connection
                </a>
                <a
                  href="https://mountainmagesigs.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline"
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