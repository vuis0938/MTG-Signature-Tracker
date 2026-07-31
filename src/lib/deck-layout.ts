"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mtg-deck-layout";
export type DeckLayout = "default" | "compact" | "list";

const LAYOUTS: DeckLayout[] = ["default", "compact", "list"];

/**
 * 套牌排版模式 Hook
 *
 * - default：默认网格，96px 大图，宽松间距
 * - compact：紧凑网格，三断点自适应（72/88/96px），移动端隐藏冗余信息
 * - list：高密度文本视图，纯文字行，适合快速浏览大套牌
 *
 * 通过 localStorage 持久化，默认 default。
 */
export function useDeckLayout() {
  const [layout, setLayout] = useState<DeckLayout>("default");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && LAYOUTS.includes(stored as DeckLayout)) {
        setLayout(stored as DeckLayout);
      }
    } catch {
      // localStorage 不可用时忽略
    }
  }, []);

  const setLayoutPersisted = useCallback((next: DeckLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
  }, []);

  /** 循环切换到下一个模式 */
  const cycle = useCallback(() => {
    setLayout((prev) => {
      const idx = LAYOUTS.indexOf(prev);
      const next = LAYOUTS[(idx + 1) % LAYOUTS.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  }, []);

  return { layout, setLayout: setLayoutPersisted, cycle } as const;
}