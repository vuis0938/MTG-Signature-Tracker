"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export function BackButton({ label = "返回" }: { label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.history.back();
        }
      }}
      className="mb-4"
    >
      <ArrowLeft className="h-4 w-4 mr-1" />
      {label}
    </Button>
  );
}
