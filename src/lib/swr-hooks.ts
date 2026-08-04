/**
 * SWR 数据获取 hooks
 *
 * 核心优势：
 * - 页面切换时瞬间显示缓存数据（stale-while-revalidate）
 * - 后台静默刷新，用户无感知
 * - 自动去重，同一 key 的并发请求只发一次
 * - 跨页面共享缓存（match 页和 decks 页共享 /api/decks 缓存）
 */

import useSWR, { mutate } from "swr";
import type { Deck, DeckStats, CardEntry, CalendarEvent } from "@/types";

// ─── 通用 fetcher ──────────────────────────────────────────

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error("请求失败") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// ─── SWR 全局配置常量 ──────────────────────────────────────

/** 重新验证间隔（毫秒）：后台刷新频率 */
export const FOCUS_REVALIDATION = {
  // 窗口聚焦时重新验证（用户切回标签页时刷新）
  revalidateOnFocus: false,
  // 网络恢复时重新验证
  revalidateOnReconnect: true,
  // 首次挂载时总是请求（确保数据最新）
  revalidateOnMount: true,
  // 失败后自动重试 1 次
  shouldRetryOnError: true,
  errorRetryCount: 1,
  // 失败后 3 秒重试
  errorRetryInterval: 3000,
  // 数据保持新鲜的时间（期间不会后台刷新）
  dedupingInterval: 5000,
} as const;

// ─── Decks 相关 hooks ──────────────────────────────────────

export interface DecksResponse {
  success: boolean;
  decks: Deck[];
  stats: Record<string, DeckStats>;
}

/** 套牌列表（含统计） — decks 页和 match 页共享缓存 */
export function useDecks(fallbackData?: DecksResponse) {
  const { data, error, isLoading, mutate: revalidate } = useSWR<DecksResponse>(
    "/api/decks",
    fetcher,
    {
      ...FOCUS_REVALIDATION,
      fallbackData,
      // 有 SSR fallback 时跳过挂载时重验证，避免双重拉取
      revalidateOnMount: fallbackData ? false : true,
    }
  );
  return { decks: data?.decks || [], stats: data?.stats || {}, error, isLoading, revalidate };
}

// ─── Cards 相关 hooks ──────────────────────────────────────

interface CardsResponse {
  success: boolean;
  cards: CardEntry[];
}

/** 指定套牌的卡牌列表 */
export function useCards(deckId: string | null) {
  const { data, error, isLoading, mutate: revalidate } = useSWR<CardsResponse>(
    deckId ? `/api/cards?deckId=${encodeURIComponent(deckId)}` : null,
    fetcher,
    FOCUS_REVALIDATION
  );
  return { cards: data?.cards || [], error, isLoading, revalidate };
}

// ─── Events 相关 hooks ─────────────────────────────────────

export interface EventsResponse {
  success: boolean;
  events: CalendarEvent[];
}

/** 活动日历列表 */
export function useEvents(fallbackData?: EventsResponse) {
  const { data, error, isLoading, mutate: revalidate } = useSWR<EventsResponse>(
    "/api/events",
    fetcher,
    {
      ...FOCUS_REVALIDATION,
      fallbackData,
      // 即使有 SSR fallback 也重新验证，防止数据源临时失败时缓存空结果
      revalidateOnMount: true,
      // 活动数据成本高（GraphQL + DB），延长去重窗口
      dedupingInterval: 30000,
    }
  );
  return { events: data?.events || [], error, isLoading, revalidate };
}

// ─── Announcements 相关 hooks ──────────────────────────────

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: string;
  created_at: string;
}

interface AnnouncementsResponse {
  success: boolean;
  announcements: Announcement[];
}

/** 系统公告 — 全局共享缓存，1 分钟内不重复请求 */
export function useAnnouncements(fallbackData?: AnnouncementsResponse) {
  const { data, error } = useSWR<AnnouncementsResponse>(
    "/api/announcements",
    fetcher,
    { ...FOCUS_REVALIDATION, dedupingInterval: 60000, fallbackData }
  );
  return { announcements: data?.announcements || [], error };
}

// ─── 手动刷新工具 ──────────────────────────────────────────

/** 刷新套牌缓存（导入/删除后调用） */
export function refreshDecks() {
  return mutate("/api/decks");
}

/** 刷新指定套牌的卡牌缓存 */
export function refreshCards(deckId: string) {
  return mutate(`/api/cards?deckId=${encodeURIComponent(deckId)}`);
}

/** 刷新活动缓存 */
export function refreshEvents() {
  return mutate("/api/events");
}
