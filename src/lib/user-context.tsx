"use client";

import { createContext, useContext, type ReactNode } from "react";

const UserContext = createContext<string>("默认用户");

/**
 * 用户上下文 Provider
 *
 * 服务端通过 cookies() 读取 userName 后传入，
 * 客户端组件通过 useUser() 获取，完全杜绝 SSR 跳变。
 */
export function UserProvider({
  userName,
  children,
}: {
  userName: string;
  children: ReactNode;
}) {
  return <UserContext.Provider value={userName}>{children}</UserContext.Provider>;
}

/** 获取当前用户名（无跳变） */
export function useUser(): string {
  return useContext(UserContext);
}