import { Loader2 } from "lucide-react";

/**
 * 路由级 loading.tsx — 点击导航链接后瞬时显示
 *
 * 作用：
 * 1. 提供即时视觉反馈，用户点击后立刻看到内容区域变化（不再"卡在旧页面"）
 * 2. 作为 prefetch 边界：动态页面的 prefetch 会覆盖到 loading.tsx 为止
 * 3. 配合 staleTimes.dynamic: 300，5 分钟内回访的页面直接从缓存瞬时显示
 *
 * 注意：layout.tsx（导航栏/公告栏）不会重新渲染，只有 <children> 区域被替换
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
    </div>
  );
}
