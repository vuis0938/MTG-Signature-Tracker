// ─── 统一类型定义 ──────────────────────────────────────────
// 所有页面和 API 路由共享的类型，避免各自定义导致不一致

/** 套牌基本信息 */
export interface Deck {
  id: string;
  name: string;
  source?: string;
  created_at?: string;
}

/** 套牌中的卡牌（数据库行） */
export interface CardEntry {
  id: string;
  deck_id: string;
  deck_name?: string;
  card_name: string;
  set_code: string;
  collector_number: string;
  artist_names: string[];
  image_url: string | null;
  status: number; // 0=未签, 1=送签中, 2=已签, 3=心动
  is_signed?: boolean;
  event_name?: string | null;
  event_date?: string | null;
}

/** 模糊匹配结果中的卡牌 — 来自 Scryfall 的印刷版本 */
export interface FuzzyCardEntry {
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  artist: string;
  /** 如果该版本正好在用户套牌中，指向套牌中的卡牌 */
  deckCard?: CardEntry;
}

/** Scryfall 印刷版本信息 */
export interface Printing {
  artist: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  released_at: string;
}

/** 画家的卡牌（用于画廊展示） */
export interface ArtistCard {
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  released_at: string;
}

/** 活动日历事件 */
export interface CalendarEvent {
  id: string;
  name: string;
  city: string;
  startDate: string;
  artists: string[];
}

/** 套牌统计 */
export interface DeckStats {
  total: number;
  unsigned: number;
  pending: number;
}

/** Moxfield 格式解析后的卡牌行 */
export interface CardRow {
  count: string;
  name: string;
  setCode: string;
  collectorNumber: string;
}