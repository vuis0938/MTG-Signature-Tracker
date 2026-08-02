"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "mtg-theme-color-v3";

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
    lightPrimary: "#0284c7",
    lightRing: "#318ac5",
    darkPrimary: "#469dd9",
    darkRing: "#4290c6",
    swatch: "#0284c7",
  },
  {
    id: "slate",
    name: "石板蓝",
    lightPrimary: "#3b82f6",
    lightRing: "#4d8af0",
    darkPrimary: "#5f9dff",
    darkRing: "#5992ef",
    swatch: "#3b82f6",
  },
  {
    id: "indigo",
    name: "靛蓝",
    lightPrimary: "#3e70f3",
    lightRing: "#4b7aec",
    darkPrimary: "#5c8dff",
    darkRing: "#5582eb",
    swatch: "#3e70f3",
  },
];

const DEFAULT_THEME = "indigo";

/** 获取默认主题对象 */
function getDefaultTheme(): ThemeColor {
  return THEME_COLORS.find((t) => t.id === DEFAULT_THEME) || THEME_COLORS[0];
}

/** 从 localStorage 读取并解析主题 */
function readStoredTheme(): ThemeColor {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const found = THEME_COLORS.find((t) => t.id === stored);
      if (found) return found;
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return getDefaultTheme();
}

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

// ─── Context ──────────────────────────────────────────────

interface ThemeColorContextValue {
  themeId: string;
  setTheme: (id: string) => void;
  toggleTheme: () => void;
}

const ThemeColorContext = createContext<ThemeColorContextValue>({
  themeId: DEFAULT_THEME,
  setTheme: () => {},
  toggleTheme: () => {},
});

// ─── Provider（全局唯一实例） ─────────────────────────────

/** 监听暗色模式切换，重新应用主题色（模块级单例） */
let darkObserver: MutationObserver | null = null;

export function ThemeColorProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME);

  useEffect(() => {
    const theme = readStoredTheme();
    setThemeId(theme.id);
    applyThemeColor(theme);

    // 若存储的主题已被移除，回写默认值
    try {
      if (localStorage.getItem(STORAGE_KEY) !== theme.id) {
        localStorage.setItem(STORAGE_KEY, theme.id);
      }
    } catch {
      // 忽略
    }

    // 监听 dark class 变化，重新应用主题色
    darkObserver?.disconnect();
    darkObserver = new MutationObserver(() => {
      const currentTheme = readStoredTheme();
      applyThemeColor(currentTheme);
    });
    darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      darkObserver?.disconnect();
      darkObserver = null;
    };
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

  return (
    <ThemeColorContext.Provider value={{ themeId, setTheme, toggleTheme }}>
      {children}
    </ThemeColorContext.Provider>
  );
}

// ─── Hook（任意组件调用，读取全局 Context） ───────────────

export function useThemeColor() {
  return useContext(ThemeColorContext);
}
