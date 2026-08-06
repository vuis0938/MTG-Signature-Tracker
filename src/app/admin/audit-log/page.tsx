"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronLeft, ChevronRight, ScrollText, Filter } from "lucide-react";

interface LogItem {
  id: string;
  admin_user: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

interface LogData {
  success: boolean;
  logs: LogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  adminUsers: string[];
}

const actionLabels: Record<string, { label: string; color: string }> = {
  user_delete: { label: "删除用户", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  user_reset_password: { label: "重置密码", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  curate_save: { label: "保存策展", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  curate_refresh: { label: "刷新策展", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  event_create: { label: "创建活动", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  event_update: { label: "更新活动", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  event_delete: { label: "删除活动", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  cache_clear_all: { label: "清空缓存", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  cache_delete: { label: "删除缓存", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  artist_alias_add: { label: "添加别名", color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" },
  artist_alias_delete: { label: "删除别名", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  announcement_create: { label: "发布公告", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  announcement_update: { label: "更新公告", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  announcement_delete: { label: "删除公告", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  data_export: { label: "数据导出", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
};

const selectClass = "flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function AuditLogPage() {
  const [data, setData] = useState<LogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // 筛选状态
  const [actionFilter, setActionFilter] = useState("");
  const [adminFilter, setAdminFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "50" });
        if (actionFilter) params.set("action", actionFilter);
        if (adminFilter) params.set("admin", adminFilter);
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);

        const res = await fetch(`/api/admin/audit-log?${params}`);
        const json = await res.json();
        if (json.success) {
          setData(json);
        }
      } catch {
        // 静默处理
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [page, actionFilter, adminFilter, startDate, endDate]);

  function handleFilterChange() {
    setPage(1);
  }

  function clearFilters() {
    setActionFilter("");
    setAdminFilter("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  function formatDateTime(date: string) {
    return new Date(date).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  const hasFilters = actionFilter || adminFilter || startDate || endDate;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">审计日志</h1>
        <p className="text-muted-foreground text-sm">
          管理员操作记录{data ? ` · 共 ${data.total} 条` : ""}
        </p>
      </div>

      {/* 筛选栏 */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">操作类型</label>
              <select
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); handleFilterChange(); }}
                className={selectClass}
              >
                <option value="">全部</option>
                {Object.entries(actionLabels).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">管理员</label>
              <select
                value={adminFilter}
                onChange={(e) => { setAdminFilter(e.target.value); handleFilterChange(); }}
                className={selectClass}
              >
                <option value="">全部</option>
                {(data?.adminUsers || []).map((admin) => (
                  <option key={admin} value={admin}>{admin}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">开始日期</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); handleFilterChange(); }}
                className="h-8 w-auto"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">结束日期</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); handleFilterChange(); }}
                className="h-8 w-auto"
              />
            </div>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="h-8">
                清除筛选
              </Button>
            )}
            {hasFilters && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                <Filter className="h-3 w-3" />
                筛选中
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              加载中...
            </div>
          ) : !data || data.logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ScrollText className="h-8 w-8 mb-2" />
              <p className="text-sm">{hasFilters ? "未找到匹配的日志" : "暂无审计日志"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">管理员</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                    <th className="px-4 py-3 font-medium">目标</th>
                    <th className="px-4 py-3 font-medium">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((log) => {
                    const meta = actionLabels[log.action] || {
                      label: log.action,
                      color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
                    };
                    return (
                      <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="px-4 py-3 font-medium">{log.admin_user}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs px-2 py-0.5 rounded ${meta.color}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {log.target || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {Object.keys(log.detail).length > 0
                            ? JSON.stringify(log.detail)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页 */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(data.totalPages, page + 1))}
            disabled={page >= data.totalPages || loading}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
