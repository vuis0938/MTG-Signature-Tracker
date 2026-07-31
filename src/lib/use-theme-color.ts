"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "mtg-theme-color";

export interface ThemeColor {
  id: string;
  name: string;
  /** 亮色模式 primary */
  lightPrimary: string;
  /** 亮色模式 ring */
  lightRing: string;
  /** 暗色模式 primary */
  darkPrimary: string;
  /** 暗色模式 ring */
  darkRing: string;
  /** 色块预览颜色 */
  swatch: string;
}

export const THEME_COLORS: ThemeColor[] = [
  {
    id: "ocean",
    name: "海蓝",
    lightPrimary: "oklch(0.588 0.139 242.0)",
    lightRing: "oklch(0.608 0.122 242.0)",
    darkPrimary: "oklch(0.668 0.122 242.0)",
    darkRing: "oklch(0.628 0.112 242.0)",
    swatch: "#0284c7",
  },
  {
    id: "slate",
    name: "石板蓝",
    lightPrimary: "oklch(0.623 0.188 259.8)",
    lightRing: "oklch(0.643 0.165 259.8)",
    darkPrimary: "oklch(0.703 0.165 259.8)",
    darkRing: "oklch(0.663 0.152 259.8)",
    swatch: "#3b82f6",
  },
  {
    id: "indigo",
    name: "靛蓝",
    lightPrimary: "oklch(0.586 0.204 264.9)",
    lightRing: "oklch(0.606 0.18 264.9)",
    darkPrimary: "oklch(0.666 0.18 264.9)",
    darkRing: "oklch(0.626 0.166 264.9)",
    swatch: "#3e70f3",
  },
];

const DEFAULT_THEME = "ocean";

function applyThemeColor(theme: ThemeColor) {
  const root = document.documentElement;
  root.style.setProperty("--primary", theme.lightPrimary);
  root.style.setProperty("--ring", theme.lightRing);
  root.style.setProperty("--sidebar-primary", theme.lightPrimary);
  root.style.setProperty("--sidebar-ring", theme.lightRing);

  // 暗色模式覆盖
  const darkMode = root.classList.contains("dark");
  if (darkMode) {
    root.style.setProperty("--primary", theme.darkPrimary);
    root.style.setProperty("--ring", theme.darkRing);
    root.style.setProperty("--sidebar-primary", theme.darkPrimary);
    root.style.setProperty("--sidebar-ring", theme.darkRing);
  }
}

/** 监听暗色模式切换，重新应用主题色 */
let darkObserver: MutationObserver | null = null;

export function useThemeColor() {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const theme = stored
        ? THEME_COLORS.find((t) => t.id === stored)
        : undefined;
      const resolved = theme || THEME_COLORS[0];
      setThemeId(resolved.id);
      applyThemeColor(resolved);
      if (!theme) {
        // 存储的主题已被移除，回写默认值
        localStorage.setItem(STORAGE_KEY, resolved.id);
      }
    } catch {
      // localStorage 不可用时忽略
    }

    // 监听 dark class 变化，重新应用主题色
    darkObserver?.disconnect();
    darkObserver = new MutationObserver(() => {
      const theme = THEME_COLORS.find((t) => t.id === localStorage.getItem(STORAGE_KEY)) || THEME_COLORS[0];
      applyThemeColor(theme);
    });
    darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => darkObserver?.disconnect();
  }, []);

  const setTheme = useCallback((id: string) => {
    const theme = THEME_COLORS.find((t) => t.id === id);
    if (!theme) return;
    setThemeId(id);
    applyThemeColor(theme);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 忽略写入失败
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const currentIndex = THEME_COLORS.findIndex((t) => t.id === themeId);
    const nextIndex = (currentIndex + 1) % THEME_COLORS.length;
    const next = THEME_COLORS[nextIndex];
    setThemeId(next.id);
    applyThemeColor(next);
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      // 忽略写入失败
    }
  }, [themeId]);

  return { themeId, setTheme, toggleTheme } as const;
}
