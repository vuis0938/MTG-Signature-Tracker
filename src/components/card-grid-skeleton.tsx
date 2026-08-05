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
  count?: number;
  rows?: number;
  className?: string;
}

export function CardGridSkeleton({ count = 12, rows, className }: CardGridSkeletonProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 items-start content-start overflow-hidden",
        className
      )}
      style={rows ? { gridTemplateRows: `repeat(${rows}, minmax(0, auto))` } : undefined}
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
