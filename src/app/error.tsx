"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, RefreshCcw } from "lucide-react";
import { reportError } from "@/lib/error-reporter";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本地控制台保留一份，方便开发调试
    console.error("[Error Boundary]", error);
    // 同时上报到服务端，管理员可在后台反馈页面查看
    reportError(error);
  }, [error]);

  return (
    <div className="flex min-h-screen min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-3xl font-bold">出错了</CardTitle>
          <CardDescription>页面加载时发生异常</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            抱歉，我们遇到了一个意外错误。您可以尝试刷新页面，或返回首页。
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">
              错误编号：{error.digest}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button onClick={reset} className="w-full">
              <RefreshCcw className="h-4 w-4 mr-2" />
              重试
            </Button>
            <Link href="/" className="w-full">
              <Button variant="outline" className="w-full">
                <Home className="h-4 w-4 mr-2" />
                返回首页
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
