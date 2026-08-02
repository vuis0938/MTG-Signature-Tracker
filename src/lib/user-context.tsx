"use client";

import { createContext, useContext, type ReactNode } from "react";

interface UserContextValue {
  userName: string;
  isAdmin: boolean;
}

const UserContext = createContext<UserContextValue>({
  userName: "默认用户",
  isAdmin: false,
});

/**
 * 用户上下文 Provider
 *
 * 服务端通过 cookies() 读取 userName 后传入，
 * 客户端组件通过 useUser() 获取，完全杜绝 SSR 跳变。
 */
export function UserProvider({
  userName,
  isAdmin,
  children,
}: {
  userName: string;
  isAdmin: boolean;
  children: ReactNode;
}) {
  return (
    <UserContext.Provider value={{ userName, isAdmin }}>
      {children}
    </UserContext.Provider>
  );
}

/** 获取当前用户信息（无跳变） */
export function useUser(): UserContextValue {
  return useContext(UserContext);
}
