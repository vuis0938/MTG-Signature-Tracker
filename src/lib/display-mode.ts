"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "mtg-card-display-mode";
export type DisplayMode = "individual" | "grouped";

/**
 * 卡片显示模式 Hook
 *
 * - individual：每张卡牌独立展示
 * - grouped：相同卡牌合并显示，带 ×N 数量角标（新用户默认）
 *
 * 通过 localStorage 持久化，跨页面、跨会话保持。
 *
 * 注意：初始值固定为默认值，避免 SSR/客户端首次渲染不一致导致的 hydration mismatch。
 * localStorage 的读取放在 useEffect 中，hydration 完成后再恢复用户偏好。
 */
export function useDisplayMode() {
  const [mode, setMode] = useState<DisplayMode>("grouped");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "individual" || stored === "grouped") {
        setMode(stored);
      }
    } catch {
      // localStorage 不可用时忽略
    }
  }, []);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === "individual" ? "grouped" : "individual";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  }, []);

  return { mode, toggle } as const;
}