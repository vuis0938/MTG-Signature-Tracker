/**
 * SWR 缓存 key 工具函数（服务端安全，不依赖 swr 包）
 *
 * 此文件独立于 swr-hooks.ts，因为 Server Component（如 page.tsx）
 * 需要这些 key 函数来构建 fallback 对象，但不能导入 swr 的 useSWR/mutate。
 */

/** 卡牌缓存 key */
export function getCardsKey(deckId: string) {
  return `/api/cards?deckId=${encodeURIComponent(deckId)}`;
}

/** 套牌缓存 key */
export function getDecksKey() {
  return "/api/decks";
}

/** 活动缓存 key */
export function getEventsKey() {
  return "/api/events";
}

/** 公告缓存 key */
export function getAnnouncementsKey() {
  return "/api/announcements";
}