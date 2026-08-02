"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface UserContextValue {
  userName: string;
  isAdmin: boolean;
  /** cookie 是否已读取完毕（客户端 hydration 后变为 true） */
  ready: boolean;
}

const UserContext = createContext<UserContextValue>({
  userName: "默认用户",
  isAdmin: false,
  ready: false,
});

/** 从客户端 cookie 读取用户名和管理员标记 */
function readUserFromCookie(): { userName: string; isAdmin: boolean } {
  if (typeof document === "undefined") return { userName: "默认用户", isAdmin: false };
  const userNameMatch = document.cookie.match(/(?:^|;\s*)user_name=([^;]*)/);
  const userName = userNameMatch ? decodeURIComponent(userNameMatch[1]) : "默认用户";
  const isAdminMatch = document.cookie.match(/(?:^|;\s*)is_admin=([^;]*)/);
  const isAdmin = isAdminMatch ? isAdminMatch[1] === "true" : false;
  return { userName, isAdmin };
}

/**
 * 用户上下文 Provider（纯客户端，不依赖服务端 cookies()）
 *
 * RootLayout 不再调用 cookies()，使整个应用可静态预渲染。
 * 用户名和管理员标记从客户端 cookie 读取（user_name + is_admin），
 * hydration 后通过 useEffect 更新，避免 SSR mismatch。
 *
 * 安全说明：
 * - is_admin cookie 可被客户端伪造，但仅控制 UI 层管理员入口的显示
 * - 所有管理员操作（策展、用户管理等）的 API 均有服务端 isAdmin() 验证
 * - admin 路由由 proxy 服务端验证，伪造 cookie 无法绕过
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserContextValue>({
    userName: "默认用户",
    isAdmin: false,
    ready: false,
  });

  useEffect(() => {
    const { userName, isAdmin } = readUserFromCookie();
    setUser({ userName, isAdmin, ready: true });
  }, []);

  return (
    <UserContext.Provider value={user}>
      {children}
    </UserContext.Provider>
  );
}

/** 获取当前用户信息 */
export function useUser(): UserContextValue {
  return useContext(UserContext);
}
