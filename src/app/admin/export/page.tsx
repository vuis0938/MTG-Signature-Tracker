"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/toast-context";
import { Download, Loader2, FileJson, FileText, Database } from "lucide-react";

export default function ExportPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const { toast: showToast } = useToast();

  async function handleExport(type: string, format: string) {
    const key = `${type}:${format}`;
    setLoading(key);
    try {
      const res = await fetch(`/api/admin/export?type=${type}&format=${format}`);
      if (!res.ok) {
        showToast("导出失败", "error");
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = `export.${format}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+?)"?$/);
        if (match) filename = match[1];
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast("导出成功", "success");
    } catch {
      showToast("网络错误", "error");
    } finally {
      setLoading(null);
    }
  }

  const exportOptions = [
    {
      title: "全站数据",
      description: "用户、套牌、卡牌、活动、别名、公告的完整数据（JSON）",
      icon: Database,
      actions: [{ type: "all", format: "json", label: "导出 JSON", icon: FileJson }],
    },
    {
      title: "用户数据",
      description: "所有注册用户的基本信息",
      icon: FileText,
      actions: [
        { type: "users", format: "json", label: "JSON", icon: FileJson },
        { type: "users", format: "csv", label: "CSV", icon: FileText },
      ],
    },
    {
      title: "套牌数据",
      description: "所有用户创建的套牌列表",
      icon: FileText,
      actions: [
        { type: "decks", format: "json", label: "JSON", icon: FileJson },
        { type: "decks", format: "csv", label: "CSV", icon: FileText },
      ],
    },
    {
      title: "卡牌数据",
      description: "所有卡牌记录（最多 50,000 条）",
      icon: FileText,
      actions: [{ type: "cards", format: "json", label: "导出 JSON", icon: FileJson }],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">数据导出</h1>
        <p className="text-muted-foreground text-sm">导出全站数据用于备份或分析</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exportOptions.map((option) => (
          <Card key={option.title}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <option.icon className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{option.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">{option.description}</p>
              <div className="flex items-center gap-2">
                {option.actions.map((action) => {
                  const key = `${action.type}:${action.format}`;
                  return (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport(action.type, action.format)}
                      disabled={loading !== null}
                    >
                      {loading === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      {action.label}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-5">
          <p className="text-xs text-muted-foreground">
            导出操作会记录到审计日志。卡牌数据限制为最近 50,000 条以避免服务器超时。
            CSV 格式仅支持单表导出，全站数据导出为 JSON 格式。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
