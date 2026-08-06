"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export function BackButton({
  label = "返回",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.history.back();
        }
      }}
      className={cn("", className)}
    >
      <ArrowLeft className="h-4 w-4 mr-1" />
      {label}
    </Button>
  );
}
