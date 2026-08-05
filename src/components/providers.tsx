"use client";

import { UserProvider } from "@/lib/user-context";
import { ToastProvider } from "@/lib/toast-context";
import { ToastContainer } from "@/components/toast-container";
import { ThemeColorProvider } from "@/lib/use-theme-color";
import { initErrorReporter } from "@/lib/error-reporter";
import type { ReactNode } from "react";

export function Providers({
  children,
}: {
  children: ReactNode;
}) {
  // 初始化全局错误上报（仅客户端、仅一次）
  initErrorReporter();

  return (
    <ThemeColorProvider>
      <UserProvider>
        <ToastProvider>
          {children}
          <ToastContainer />
        </ToastProvider>
      </UserProvider>
    </ThemeColorProvider>
  );
}
