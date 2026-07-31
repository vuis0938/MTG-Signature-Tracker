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
    id: "ocean",
    name: "海蓝",
    lightPrimary: "oklch(0.52 0.17 220)",
    lightRing: "oklch(0.55 0.15 220)",
    darkPrimary: "oklch(0.66 0.16 220)",
    darkRing: "oklch(0.60 0.14 220)",
    swatch: "#0284c7",
  },
  {
    id: "cobalt",
    name: "钴蓝",
    lightPrimary: "oklch(0.50 0.16 255)",
    lightRing: "oklch(0.53 0.14 255)",
    darkPrimary: "oklch(0.65 0.17 255)",
    darkRing: "oklch(0.60 0.14 255)",
    swatch: "#3b82f6",
  },
  {
    id: "slate",
    name: "石板蓝",
    lightPrimary: "oklch(0.50 0.05 250)",
    lightRing: "oklch(0.53 0.04 250)",
    darkPrimary: "oklch(0.65 0.05 250)",
    darkRing: "oklch(0.58 0.04 250)",
    swatch: "#64748b",
  },
  {
    id: "brown",
    name: "棕色",
    lightPrimary: "oklch(0.48 0.08 55)",
    lightRing: "oklch(0.51 0.06 55)",
    darkPrimary: "oklch(0.62 0.08 55)",
    darkRing: "oklch(0.56 0.06 55)",
    swatch: "#8b5e3c",
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

  return { themeId, setTheme } as const;
}
