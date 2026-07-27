"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mtg-card-display-mode";
export type DisplayMode = "individual" | "grouped";

/**
 * 卡片显示模式 Hook
 *
 * - individual：每张卡牌独立展示
 * - grouped：相同卡牌合并显示，带 ×N 数量角标（新用户默认）
 *
 * 通过 localStorage 持久化，跨页面、跨会话保持。
 */
export function useDisplayMode() {
  const [mode, setMode] = useState<DisplayMode>("grouped");

  // 初始化时从 localStorage 读取，覆盖默认值
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "individual") setMode("individual");
      else if (stored === "grouped") setMode("grouped");
      // 没存过就用默认 grouped，不覆盖
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