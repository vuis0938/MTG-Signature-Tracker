import { cn } from "@/lib/utils";

function CardSkeleton() {
  return (
    <div className="rounded-lg border overflow-hidden bg-background animate-pulse">
      <div className="w-full aspect-[5/7] bg-muted" />
      <div className="p-1.5 space-y-1.5">
        <div className="h-3 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
      </div>
    </div>
  );
}

interface CardGridSkeletonProps {
  rows?: number;
  className?: string;
}

/**
 * 按当前响应式列数渲染「刚好 rows 行」的骨架卡片，避免 grid-template-rows
 * 截断失效导致容器被多余卡片撑高。
 *
 * 列数：默认 2 / sm 3 / md 4 / lg 5 / xl 6
 */
export function CardGridSkeleton({ rows = 2, className }: CardGridSkeletonProps) {
  const total = rows * 6; // xl 最多 6 列

  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 items-start content-start",
        className
      )}
    >
      {Array.from({ length: total }).map((_, i) => {
        const indexInGrid = i + 1;
        const visibleClass =
          indexInGrid <= rows * 2
            ? undefined
            : indexInGrid <= rows * 3
            ? "hidden sm:block"
            : indexInGrid <= rows * 4
            ? "hidden md:block"
            : indexInGrid <= rows * 5
            ? "hidden lg:block"
            : "hidden xl:block";

        return (
          <div key={i} className={visibleClass}>
            <CardSkeleton />
          </div>
        );
      })}
    </div>
  );
}
