"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Layers, CreditCard, CheckCircle, Clock, TrendingUp } from "lucide-react";

interface UserDetail {
  success: boolean;
  user: {
    username: string;
    createdAt: string;
    lastActiveAt: string;
    bannedAt: string | null;
    isBanned: boolean;
  };
  decks: {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    cardCount: number;
    signedCount: number;
    pendingCount: number;
    unsignedCount: number;
  }[];
  stats: {
    totalDecks: number;
    totalCards: number;
    totalSigned: number;
    totalPending: number;
    totalUnsigned: number;
    signRate: number;
  };
  topArtists: { name: string; count: number }[];
}

export default function UserDetailPage() {
  const params = useSearchParams();
  const username = params.get("username");
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!username) {
      setError("缺少用户名参数");
      setLoading(false);
      return;
    }
    async function load() {
      try {
        const res = await fetch(`/api/admin/users/detail?username=${encodeURIComponent(username!)}`);
        const json = await res.json();
        if (json.success) {
          setData(json);
        } else {
          setError(json.error || "加载失败");
        }
      } catch {
        setError("网络错误");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [username]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/admin/users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回用户列表
          </Button>
        </Link>
        <div className="flex items-center justify-center min-h-[40vh] text-destructive">
          {error || "数据加载失败"}
        </div>
      </div>
    );
  }

  const { user, decks, stats, topArtists } = data;
  const maxArtist = Math.max(...topArtists.map((a) => a.count), 1);

  function formatDate(date: string | null) {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  const statCards = [
    { label: "套牌数", value: stats.totalDecks, icon: Layers, color: "text-purple-600" },
    { label: "卡牌总数", value: stats.totalCards, icon: CreditCard, color: "text-cyan-600" },
    { label: "已签绘", value: stats.totalSigned, icon: CheckCircle, color: "text-emerald-600" },
    { label: "签绘率", value: `${stats.signRate}%`, icon: TrendingUp, color: "text-blue-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users">
          <Button variant="ghost" size="sm" className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回用户列表
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{user.username}</h1>
        <p className="text-muted-foreground text-sm">
          注册于 {formatDate(user.createdAt)} · 最后活跃 {formatDate(user.lastActiveAt)}
          {user.isBanned && <span className="text-red-600 ml-2">· 已封禁</span>}
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{card.label}</span>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 套牌列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">套牌列表</CardTitle>
          </CardHeader>
          <CardContent>
            {decks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">该用户暂无套牌</p>
            ) : (
              <div className="space-y-2">
                {decks.map((deck) => (
                  <div key={deck.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">{deck.name}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{deck.cardCount} 张</span>
                        {deck.signedCount > 0 && (
                          <span className="text-emerald-600">{deck.signedCount} 已签</span>
                        )}
                        {deck.pendingCount > 0 && (
                          <span className="text-amber-600">{deck.pendingCount} 送签</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDate(deck.updated_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 热门画家 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">收藏画家 Top 10</CardTitle>
          </CardHeader>
          <CardContent>
            {topArtists.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
            ) : (
              <div className="space-y-2">
                {topArtists.map((artist, i) => (
                  <div key={artist.name} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                    <span className="text-sm flex-1 truncate">{artist.name}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-24">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${(artist.count / maxArtist) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{artist.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 卡牌状态分布 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">卡牌签绘状态分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: "已签绘", count: stats.totalSigned, color: "bg-emerald-500", icon: CheckCircle },
              { label: "送签中", count: stats.totalPending, color: "bg-amber-500", icon: Clock },
              { label: "未签绘", count: stats.totalUnsigned, color: "bg-gray-400", icon: CreditCard },
            ].map((item) => {
              const pct = stats.totalCards > 0 ? (item.count / stats.totalCards) * 100 : 0;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {item.label}
                    </span>
                    <span className="text-muted-foreground">{item.count} 张 ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
