"use client";

import { UserProvider } from "@/lib/user-context";
import { ToastProvider } from "@/lib/toast-context";
import { ToastContainer } from "@/components/toast-container";
import type { ReactNode } from "react";

export function Providers({
  userName,
  children,
}: {
  userName: string;
  children: ReactNode;
}) {
  return (
    <UserProvider userName={userName}>
      <ToastProvider>
        {children}
        <ToastContainer />
      </ToastProvider>
    </UserProvider>
  );
}