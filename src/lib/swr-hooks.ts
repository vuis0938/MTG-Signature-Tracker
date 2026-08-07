/**
 * SWR 数据获取 hooks
 *
 * 核心优势：
 * - 页面切换时瞬间显示缓存数据（stale-while-revalidate）
 * - 跨页面共享缓存（match 页和 decks 页共享 /api/decks、/api/cards 缓存）
 * - 自动去重，同一 key 的并发请求只发一次
 * - 手动/乐观更新缓存，避免用户看到意外的自动刷新
 */

import useSWR, { mutate } from "swr";
import type { Deck, DeckStats, CardEntry, CalendarEvent } from "@/types";

// ─── 通用 fetcher ──────────────────────────────────────────

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const error = new Error("请求失败") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// ─── SWR 配置常量 ──────────────────────────────────────────

/**
 * 静态缓存配置：不自动刷新
 * 用于 decks、cards 等用户操作后会手动/乐观更新缓存的数据。
 * 避免窗口聚焦、网络恢复、组件挂载时触发意外的后台请求。
 */
export const STATIC_CACHE_CONFIG = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateOnMount: false,
  shouldRetryOnError: true,
  errorRetryCount: 1,
  errorRetryInterval: 3000,
  dedupingInterval: 5000,
} as const;

/**
 * 后台重新验证配置：允许网络恢复时刷新
 * 用于 events、announcements 等对实时性要求稍高的数据。
 */
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
      ...STATIC_CACHE_CONFIG,
      fallbackData,
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
export function useCards(deckId: string | null, fallbackData?: CardsResponse) {
  const { data, error, isLoading, mutate: revalidate } = useSWR<CardsResponse>(
    deckId ? `/api/cards?deckId=${encodeURIComponent(deckId)}` : null,
    fetcher,
    {
      ...STATIC_CACHE_CONFIG,
      fallbackData,
    }
  );
  return { cards: data?.cards || [], error, isLoading, revalidate };
}

/** 卡牌缓存 key */
export function getCardsKey(deckId: string) {
  return `/api/cards?deckId=${encodeURIComponent(deckId)}`;
}

/**
 * 乐观更新指定套牌的卡牌缓存（不触发请求）
 * 用于 decks 页和 match 页改状态后即时同步 UI
 */
export function mutateCards(
  deckId: string,
  updater: (cards: CardEntry[]) => CardEntry[]
) {
  const key = getCardsKey(deckId);
  return mutate(
    key,
    (current: CardsResponse | undefined) => {
      if (!current) return current;
      return { ...current, cards: updater(current.cards) };
    },
    false
  );
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

/**
 * 强制获取最新套牌数据 — 绕过 dedupingInterval 限制
 *
 * SWR 的 dedupingInterval 会拦截 5 秒内的重复请求，
 * 导致导入/删除后 revalidate() 不发实际请求、拿不到新数据。
 * 此函数直接 fetch 拿到最新数据，返回给调用方，
 * 调用方用 useSWR 的 bound mutate（revalidate）写入本地状态。
 */
export async function fetchDecksFresh(): Promise<DecksResponse | undefined> {
  try {
    const res = await fetch("/api/decks", { cache: "no-store" });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/** 刷新指定套牌的卡牌缓存 */
export function refreshCards(deckId: string) {
  return mutate(`/api/cards?deckId=${encodeURIComponent(deckId)}`);
}

/** 刷新活动缓存 */
export function refreshEvents() {
  return mutate("/api/events");
}
