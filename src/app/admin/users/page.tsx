"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/toast-context";
import { Search, Trash2, KeyRound, Loader2, Eye } from "lucide-react";

interface UserItem {
  username: string;
  createdAt: string;
  lastActiveAt: string;
  deckCount: number;
  cardCount: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ user: string; password: string } | null>(null);
  const { toast: showToast } = useToast();

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      } else {
        showToast(data.error || "加载失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAction(username: string, action: "delete" | "reset_password") {
    const actionText = action === "delete" ? "删除" : "重置密码";
    if (action === "delete") {
      if (!confirm(`确定删除用户 ${username}？\n\n该操作会永久删除该用户的所有套牌和卡牌数据，且不可恢复。`)) return;
    } else if (!confirm(`确定对用户 ${username} 执行「${actionText}」操作？`)) return;

    setActionLoading(`${username}:${action}`);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, username }),
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, "success");
        if (action === "reset_password" && data.tempPassword) {
          setTempPassword({ user: username, password: data.tempPassword });
        }
        await loadUsers();
      } else {
        showToast(data.error || "操作失败", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = users.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()),
  );

  function formatDate(date: string | null) {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
        <p className="text-muted-foreground text-sm">共 {users.length} 个注册用户</p>
      </div>

      {/* 搜索 */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索用户名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 临时密码弹窗 */}
      {tempPassword && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  用户 {tempPassword.user} 的临时密码：
                </p>
                <code className="block mt-2 px-3 py-2 bg-background border rounded text-sm font-mono select-all">
                  {tempPassword.password}
                </code>
                <p className="text-xs text-muted-foreground mt-2">
                  请将此密码安全地传达给用户。此密码仅显示一次，关闭后无法再次查看。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTempPassword(null)}
              >
                关闭
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 用户列表 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {search ? "未找到匹配用户" : "暂无用户"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">用户名</th>
                    <th className="px-4 py-3 font-medium">注册时间</th>
                    <th className="px-4 py-3 font-medium">最后活跃</th>
                    <th className="px-4 py-3 font-medium text-center">套牌</th>
                    <th className="px-4 py-3 font-medium text-center">卡牌</th>
                    <th className="px-4 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.username} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        <a href={`/admin/users/detail?username=${encodeURIComponent(user.username)}`} className="hover:text-primary hover:underline">
                          {user.username}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(user.createdAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(user.lastActiveAt)}</td>
                      <td className="px-4 py-3 text-center">{user.deckCount}</td>
                      <td className="px-4 py-3 text-center">{user.cardCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <a href={`/admin/users/detail?username=${encodeURIComponent(user.username)}`}>
                            <Button variant="ghost" size="sm" title="查看详情">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAction(user.username, "delete")}
                            disabled={actionLoading === `${user.username}:delete`}
                            className="text-red-600 hover:text-red-700"
                          >
                            {actionLoading === `${user.username}:delete` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            删除
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAction(user.username, "reset_password")}
                            disabled={actionLoading === `${user.username}:reset_password`}
                          >
                            {actionLoading === `${user.username}:reset_password` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <KeyRound className="h-3.5 w-3.5" />
                            )}
                            重置密码
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
