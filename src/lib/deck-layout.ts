"use client";

import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "mtg-deck-layout";
export type DeckLayout = "default" | "compact" | "list";
const LAYOUTS: DeckLayout[] = ["default", "compact", "list"];
const DEFAULT_LAYOUT: DeckLayout = "default";

const listeners = new Set<() => void>();

function getSnapshot(): DeckLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && LAYOUTS.includes(stored as DeckLayout)) {
      return stored as DeckLayout;
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return DEFAULT_LAYOUT;
}

function getServerSnapshot(): DeckLayout {
  return DEFAULT_LAYOUT;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", storageHandler);
  };
}

function notify() {
  listeners.forEach((cb) => cb());
}

/**
 * 套牌排版模式 Hook
 *
 * - default：默认网格，96px 大图，宽松间距
 * - compact：紧凑网格，三断点自适应（72/88/96px），移动端隐藏冗余信息
 * - list：高密度文本视图，纯文字行，适合快速浏览大套牌
 *
 * 通过 localStorage 持久化，默认 default。
 *
 * 使用 useSyncExternalStorage 订阅 localStorage，服务端/ hydration 阶段固定返回默认值，
 * 避免 SSR 与客户端首次渲染不一致导致的 hydration mismatch。
 */
export function useDeckLayout() {
  const layout = useSyncExternalStore<DeckLayout>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setLayout = useCallback((next: DeckLayout) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
    notify();
  }, []);

  /** 循环切换到下一个模式 */
  const cycle = useCallback(() => {
    const idx = LAYOUTS.indexOf(layout);
    const next = LAYOUTS[(idx + 1) % LAYOUTS.length];
    setLayout(next);
  }, [layout, setLayout]);

  return { layout, setLayout, cycle } as const;
}
