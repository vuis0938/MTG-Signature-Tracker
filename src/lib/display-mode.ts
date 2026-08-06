"use client";

import { useSyncExternalStore, useCallback } from "react";

const STORAGE_KEY = "mtg-card-display-mode";
export type DisplayMode = "individual" | "grouped";
const DEFAULT_MODE: DisplayMode = "grouped";
const VALID_MODES: DisplayMode[] = ["individual", "grouped"];

const listeners = new Set<() => void>();

function getSnapshot(): DisplayMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_MODES.includes(stored as DisplayMode)) {
      return stored as DisplayMode;
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return DEFAULT_MODE;
}

function getServerSnapshot(): DisplayMode {
  return DEFAULT_MODE;
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
 * 卡片显示模式 Hook
 *
 * - individual：每张卡牌独立展示
 * - grouped：相同卡牌合并显示，带 ×N 数量角标（新用户默认）
 *
 * 通过 localStorage 持久化，跨页面、跨会话保持。
 *
 * 使用 useSyncExternalStorage 订阅 localStorage，服务端/ hydration 阶段固定返回默认值，
 * 避免 SSR 与客户端首次渲染不一致导致的 hydration mismatch。
 */
export function useDisplayMode() {
  const mode = useSyncExternalStore<DisplayMode>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toggle = useCallback(() => {
    const next = mode === "individual" ? "grouped" : "individual";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
    notify();
  }, [mode]);

  return { mode, toggle } as const;
}
