import { Loader2 } from "lucide-react";

/** 管理后台路由级 loading — 点击导航后瞬时显示，不再卡在旧页面 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
    </div>
  );
}
