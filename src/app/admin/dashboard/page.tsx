"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Layers, CreditCard, CheckCircle, Clock, TrendingUp } from "lucide-react";

interface DashboardData {
  success: boolean;
  stats: {
    totalUsers: number;
    activeUsers7d: number;
    activeUsers30d: number;
    bannedUsers: number;
    totalDecks: number;
    totalCards: number;
    signedCards: number;
    pendingCards: number;
    unsignedCards: number;
    signRate: number;
  };
  registrationTrend: { date: string; count: number }[];
  topArtists: { name: string; count: number }[];
  topSets: { name: string; count: number }[];
  recentLogs: { id: string; admin_user: string; action: string; target: string | null; created_at: string }[];
}

const actionLabels: Record<string, { label: string; color: string }> = {
  user_ban: { label: "封禁用户", color: "text-red-600" },
  user_unban: { label: "解封用户", color: "text-emerald-600" },
  user_reset_password: { label: "重置密码", color: "text-amber-600" },
  curate_save: { label: "保存策展", color: "text-blue-600" },
  curate_refresh: { label: "刷新策展", color: "text-blue-600" },
  event_create: { label: "创建活动", color: "text-purple-600" },
  event_update: { label: "更新活动", color: "text-purple-600" },
  event_delete: { label: "删除活动", color: "text-red-600" },
  cache_clear_all: { label: "清空缓存", color: "text-orange-600" },
  cache_delete: { label: "删除缓存", color: "text-orange-600" },
  artist_alias_add: { label: "添加别名", color: "text-teal-600" },
  artist_alias_delete: { label: "删除别名", color: "text-red-600" },
  announcement_create: { label: "发布公告", color: "text-indigo-600" },
  announcement_update: { label: "更新公告", color: "text-indigo-600" },
  announcement_delete: { label: "删除公告", color: "text-red-600" },
  data_export: { label: "数据导出", color: "text-gray-600" },
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/dashboard");
        const json = await res.json();
        if (json.success) {
          setData(json);
        } else {
          setError(json.error || "加载失败");
        }
      } catch {
        setError("网络错误，请重试");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-destructive">
        {error || "数据加载失败"}
      </div>
    );
  }

  const s = data.stats;
  const maxReg = Math.max(...data.registrationTrend.map((t) => t.count), 1);
  const maxArtist = Math.max(...data.topArtists.map((a) => a.count), 1);
  const maxSet = Math.max(...data.topSets.map((a) => a.count), 1);

  const statCards = [
    { label: "注册用户", value: s.totalUsers, icon: Users, sub: `7日活跃 ${s.activeUsers7d} · 30日活跃 ${s.activeUsers30d}`, color: "text-blue-600" },
    { label: "套牌总数", value: s.totalDecks, icon: Layers, sub: `平均 ${s.totalUsers > 0 ? (s.totalDecks / s.totalUsers).toFixed(1) : 0} 副/人`, color: "text-purple-600" },
    { label: "卡牌总数", value: s.totalCards, icon: CreditCard, sub: `平均 ${s.totalUsers > 0 ? (s.totalCards / s.totalUsers).toFixed(0) : 0} 张/人`, color: "text-cyan-600" },
    { label: "签绘完成率", value: `${s.signRate}%`, icon: TrendingUp, sub: `已签 ${s.signedCards} · 送签 ${s.pendingCards} · 待签 ${s.unsignedCards}`, color: "text-emerald-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
        <p className="text-muted-foreground text-sm">平台整体数据概览</p>
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
              <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 状态分布 + 注册趋势 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 卡牌状态分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">卡牌状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "已签", count: s.signedCards, color: "bg-emerald-500", icon: CheckCircle },
                { label: "送签中", count: s.pendingCards, color: "bg-amber-500", icon: Clock },
                { label: "未签", count: s.unsignedCards, color: "bg-gray-400", icon: CreditCard },
              ].map((item) => {
                const pct = s.totalCards > 0 ? (item.count / s.totalCards) * 100 : 0;
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

        {/* 注册趋势 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">注册趋势（近 14 天）</CardTitle>
          </CardHeader>
          <CardContent>
            {data.registrationTrend.every((t) => t.count === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8">近期无新注册用户</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {data.registrationTrend.map((t) => (
                  <div key={t.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-xs text-muted-foreground">{t.count > 0 ? t.count : ""}</div>
                    <div
                      className="w-full bg-primary/70 rounded-t hover:bg-primary transition-colors"
                      style={{ height: `${(t.count / maxReg) * 100}%`, minHeight: t.count > 0 ? "4px" : "0" }}
                      title={`${t.date}: ${t.count} 人`}
                    />
                    <div className="text-[10px] text-muted-foreground">
                      {t.date.slice(5)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 热门画家 + 热门系列 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 热门画家 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">热门画家 Top 10</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topArtists.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
            ) : (
              <div className="space-y-2">
                {data.topArtists.map((artist, i) => (
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

        {/* 热门系列 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">热门系列 Top 10</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topSets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
            ) : (
              <div className="space-y-2">
                {data.topSets.map((set, i) => (
                  <div key={set.name} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                    <span className="text-sm flex-1 truncate">{set.name}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-24">
                      <div
                        className="h-full bg-purple-500"
                        style={{ width: `${(set.count / maxSet) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">{set.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 最近管理操作 */}
      {data.recentLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近管理操作</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.recentLogs.map((log) => {
                const meta = actionLabels[log.action] || { label: log.action, color: "text-muted-foreground" };
                return (
                  <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                    <span className={`font-medium ${meta.color} w-20 shrink-0`}>{meta.label}</span>
                    <span className="text-muted-foreground shrink-0">{log.admin_user}</span>
                    {log.target && (
                      <span className="text-foreground">→ {log.target}</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
