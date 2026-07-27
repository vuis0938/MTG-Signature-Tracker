"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mtg-card-display-mode";
export type DisplayMode = "individual" | "grouped";

/**
 * 卡片显示模式 Hook
 *
 * - individual：每张卡牌独立展示（默认）
 * - grouped：相同卡牌合并显示，带 ×N 数量角标
 *
 * 通过 localStorage 持久化，跨页面、跨会话保持。
 */
export function useDisplayMode() {
  const [mode, setMode] = useState<DisplayMode>("individual");

  // 初始化时从 localStorage 读取
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "grouped") setMode("grouped");
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