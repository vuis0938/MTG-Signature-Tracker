"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mtg-compact-mode";

/**
 * 紧凑模式 Hook
 *
 * 启用后，套牌管理界面会针对手机、平板、桌面三个断点做自适应优化：
 * - 卡牌尺寸缩小、间距收紧
 * - 移动端隐藏冗余信息（底部卡牌名、🎨 emoji）
 * - 标题字号随屏幕递减
 *
 * 通过 localStorage 持久化，默认关闭。
 */
export function useCompactMode() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setCompact(true);
    } catch {
      // localStorage 不可用时忽略
    }
  }, []);

  const toggle = useCallback(() => {
    setCompact((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  }, []);

  return { compact, toggle } as const;
}