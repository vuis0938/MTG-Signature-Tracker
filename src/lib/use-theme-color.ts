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
    id: "sky",
    name: "天蓝",
    lightPrimary: "oklch(0.55 0.16 230)",
    lightRing: "oklch(0.58 0.14 230)",
    darkPrimary: "oklch(0.68 0.15 230)",
    darkRing: "oklch(0.62 0.14 230)",
    swatch: "#0ea5e9",
  },
  {
    id: "indigo",
    name: "靛蓝",
    lightPrimary: "oklch(0.50 0.18 265)",
    lightRing: "oklch(0.55 0.15 265)",
    darkPrimary: "oklch(0.65 0.20 265)",
    darkRing: "oklch(0.60 0.15 265)",
    swatch: "#6366f1",
  },
  {
    id: "violet",
    name: "紫罗兰",
    lightPrimary: "oklch(0.52 0.20 295)",
    lightRing: "oklch(0.56 0.16 295)",
    darkPrimary: "oklch(0.68 0.18 295)",
    darkRing: "oklch(0.62 0.15 295)",
    swatch: "#a855f7",
  },
  {
    id: "emerald",
    name: "翠绿",
    lightPrimary: "oklch(0.52 0.15 160)",
    lightRing: "oklch(0.56 0.13 160)",
    darkPrimary: "oklch(0.68 0.15 160)",
    darkRing: "oklch(0.62 0.13 160)",
    swatch: "#10b981",
  },
  {
    id: "amber",
    name: "琥珀",
    lightPrimary: "oklch(0.60 0.14 75)",
    lightRing: "oklch(0.62 0.12 75)",
    darkPrimary: "oklch(0.72 0.14 75)",
    darkRing: "oklch(0.66 0.12 75)",
    swatch: "#f59e0b",
  },
];

const DEFAULT_THEME = "sky";

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
      if (stored) {
        const theme = THEME_COLORS.find((t) => t.id === stored);
        if (theme) {
          setThemeId(stored);
          applyThemeColor(theme);
        }
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

  return { themeId, setTheme } as const;
}
