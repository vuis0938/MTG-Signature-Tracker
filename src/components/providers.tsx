"use client";

import { UserProvider } from "@/lib/user-context";
import { ToastProvider } from "@/lib/toast-context";
import { ToastContainer } from "@/components/toast-container";
import { ThemeColorProvider } from "@/lib/use-theme-color";
import type { ReactNode } from "react";

export function Providers({
  children,
}: {
  children: ReactNode;
}) {
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
