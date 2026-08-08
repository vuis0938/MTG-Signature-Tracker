"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CardImage } from "@/components/card-image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDisplayMode } from "@/lib/display-mode";
import { useToast } from "@/lib/toast-context";
import { useLatestRef } from "@/lib/use-latest-ref";
import { preloadData, getPreloadedData, preloadDialogChunks } from "@/lib/preload";
import { useDecks, useEvents, mutateCards } from "@/lib/swr-hooks";
import {
  Search, Play, Download, CheckSquare, Square, Loader2, Sparkles, Sparkle, Palette, Package, Heart, Check, MoreHorizontal, Lightbulb, ChevronDown, X,
} from "lucide-react";
import ArtistGalleryDialog from "@/components/artist-gallery-dialog";

// ─── 类型定义 ──────────────────────────────────────────────

import type { Deck, DeckStats, CardEntry, FuzzyCardEntry, ArtistCard, CalendarEvent } from "@/types";
import { normalizeArtists, buildNormalizedMap, findMatchingArtist, isSamePrinting, getNextMatchStatus, matchAgainstArtists, safeNormalize } from "@/lib/match-utils";
import type { FuzzyApiResponse } from "@/lib/match-utils";

// ─── 防 UC 缓存工具 ────────────────────────────────────────

/**
 * 防 UC 浏览器云端加速/省流模式拦截响应的请求封装
 *
 * UC 浏览器的"云端加速"会缓存 POST 请求的响应，返回缓存的 HTML 而非 JSON。
 * 策略：URL 追加随机参数（绕过缓存键），不依赖可能被代理忽略的 HTTP 头。
 */
function apiPost(path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${path}${sep}_t=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * 检测响应是否被 UC 等浏览器的省流/云端加速拦截篡改
 */
function isHtmlResponse(res: Response, text: string): boolean {
  const contentType = res.headers.get("content-type") || "";
  return !contentType.includes("application/json") || text.trim().startsWith("<");
}

// ─── 页面组件 ──────────────────────────────────────────────

interface MatchClientProps {
  fallbackDecks?: Deck[];
  fallbackStats?: Record<string, DeckStats>;
  fallbackEvents?: CalendarEvent[];
}

export default function MatchClient({
  fallbackDecks,
  fallbackStats,
  fallbackEvents,
}: MatchClientProps = {}) {
  // 名单解析
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState("");
  const [parsedArtists, setParsedArtists] = useState<string[]>([]);
  const [parseMethod, setParseMethod] = useState("");

  // 套牌选择 — SWR 获取，跨页面共享缓存（使用 SSR fallback 首屏零加载）
  const fallbackData =
    fallbackDecks !== undefined
      ? { success: true, decks: fallbackDecks, stats: fallbackStats || {} }
      : undefined;
  const { decks, revalidate: refreshDecks } = useDecks(fallbackData);
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());

  // decks 加载后默认全选（仅首次，避免用户取消全选后被重新全选）
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (decks.length > 0 && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      setSelectedDecks(new Set(decks.map((d) => d.id)));
    }
  }, [decks]);

  // 活动列表 — SWR 获取，跨页面共享缓存（与活动页共享 /api/events 缓存）
  // 使用 SSR fallback，首屏零加载
  const eventsFallback =
    fallbackEvents !== undefined
      ? { success: true, events: fallbackEvents }
      : undefined;
  const { events } = useEvents(eventsFallback);

  // 匹配
  const [matching, setMatching] = useState(false);
  const [fuzzyMode, setFuzzyMode] = useState(false);
  const { mode: displayMode } = useDisplayMode();
  const [matchError, setMatchError] = useState("");
  const [matched, setMatched] = useState<Map<string, CardEntry[]>>(new Map());
  const [fuzzyMatched, setFuzzyMatched] = useState<Map<string, FuzzyCardEntry[]>>(new Map());
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [currentEvent, setCurrentEvent] = useState("");
  const [currentEventDate, setCurrentEventDate] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [eventsOpen, setEventsOpen] = useState(false);

  // 画家卡牌弹窗
  const [artistDialog, setArtistDialog] = useState<string | null>(null);
  const [artistCards, setArtistCards] = useState<ArtistCard[]>([]);
  const [artistCardsLoading, setArtistCardsLoading] = useState(false);

  const [hasRun, setHasRun] = useState(false);

  // Toast
  const { toast: showToast } = useToast();

  // 页面加载后空闲时预加载弹窗 chunk
  useEffect(() => {
    preloadDialogChunks();
  }, []);

  // 全局错误捕获：兜底未在 try/catch 中捕获的错误，显示到页面
  useEffect(() => {
    function onError(e: ErrorEvent) {
      console.error("[全局错误]", e.message, e.error);
      setMatchError(`未捕获错误: ${e.message}`);
    }
    function onRejection(e: PromiseRejectionEvent) {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
      console.error("[未处理的 Promise 拒绝]", msg, e.reason);
      setMatchError(`异步错误: ${msg}`);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Ref 锁定最新状态，避免闭包陷阱（useLatestRef 在 effect 中同步，避免 render 阶段写 ref）
  const selectedDecksRef = useLatestRef(selectedDecks);
  const parsedArtistsRef = useLatestRef(parsedArtists);
  const decksRef = useLatestRef(decks);
  const fuzzyModeRef = useLatestRef(fuzzyMode);
  const matchingRef = useRef(false);
  const matchedRef = useLatestRef(matched);
  const fuzzyMatchedRef = useLatestRef(fuzzyMatched);
  const eventsRef = useLatestRef(events);
  const currentEventRef = useLatestRef(currentEvent);
  const currentEventDateRef = useLatestRef(currentEventDate);

  // ─── 辅助函数 ──────────────────────────────────────────

  /** 重置匹配结果 */
  function resetMatchState() {
    setMatched(new Map());
    setFuzzyMatched(new Map());
    setUnmatched([]);
    setHasRun(false);
  }

  /** 查询多个套牌的所有卡牌 */
  async function fetchCardsByDeckIds(deckIds: string[]): Promise<CardEntry[]> {
    try {
      const res = await apiPost("/api/cards/batch", { deckIds });
      const text = await res.text();

      if (isHtmlResponse(res, text)) {
        setMatchError("浏览器省流模式干扰了匹配，请关闭 UC 极速/云端加速后重试");
        return [];
      }

      if (!res.ok) {
        setMatchError(`服务器返回错误 (${res.status})，请重试`);
        return [];
      }

      const data = JSON.parse(text);
      if (data.success && data.cards) {
        return data.cards as CardEntry[];
      }
      if (data.error) {
        setMatchError(String(data.error));
      }
      return [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[查询] 套牌查询异常:`, msg);
      setMatchError(`网络请求失败: ${msg}`);
      return [];
    }
  }

  // ─── 事件处理 ──────────────────────────────────────────

  /** 检测解析的画家名单与已有活动的重合度，返回最佳匹配活动 */
  function detectMatchingEvent(artists: string[], eventList: CalendarEvent[]): CalendarEvent | null {
    if (artists.length === 0 || eventList.length === 0) return null;

    const parsedSet = new Set(artists.map((a) => a.toLowerCase().trim()));

    // 分别记录展会(mtgac)和平台寄签(mountain_mage)的最佳匹配
    let bestShowEvent: CalendarEvent | null = null;
    let bestShowRatio = 0;
    let bestPlatformEvent: CalendarEvent | null = null;
    let bestPlatformRatio = 0;

    for (const event of eventList) {
      const eventSet = new Set(event.artists.map((a) => a.toLowerCase().trim()));
      let overlap = 0;
      for (const a of parsedSet) {
        if (eventSet.has(a)) overlap++;
      }
      // 重合度 = 交集 / 解析画家数
      const ratio = overlap / parsedSet.size;

      if (event.source === "mtgac") {
        if (ratio > bestShowRatio) {
          bestShowRatio = ratio;
          bestShowEvent = event;
        }
      } else {
        if (ratio > bestPlatformRatio) {
          bestPlatformRatio = ratio;
          bestPlatformEvent = event;
        }
      }
    }

    // 优先展会活动，其次平台寄签，均需 > 90%
    if (bestShowRatio > 0.9) return bestShowEvent;
    if (bestPlatformRatio > 0.9) return bestPlatformEvent;
    return null;
  }

  /** 合并所有已选活动的画家名单（去重） */
  function getMergedArtists(eventIds: Set<string>, eventList: CalendarEvent[]): string[] {
    const artistSet = new Set<string>();
    for (const id of eventIds) {
      const event = eventList.find((e) => e.id === id);
      if (event) {
        for (const a of event.artists) artistSet.add(a);
      }
    }
    return [...artistSet];
  }

  function toggleEvent(eventId: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }

      if (next.size === 0) {
        setRawText("");
        setParsedArtists([]);
        setParseMethod("");
        setCurrentEvent("");
        setCurrentEventDate("");
        resetMatchState();
        return next;
      }

      const merged = getMergedArtists(next, events);
      const selectedList = [...next].map((id) => events.find((e) => e.id === id)).filter(Boolean) as CalendarEvent[];
      setRawText(merged.join("\n"));
      setParsedArtists(merged);
      setParseMethod("活动日历");
      setCurrentEvent(selectedList.map((e) => e.name).join("、"));
      setCurrentEventDate(selectedList.map((e) => new Date(e.startDate).toLocaleDateString("zh-CN")).join("、"));
      resetMatchState();
      return next;
    });
  }

  const handleArtistClick = useCallback(async (artist: string) => {
    setArtistDialog(artist);
    setArtistCards([]);
    setArtistCardsLoading(true);

    try {
      // 优先取 hover 预加载的缓存数据（命中时零延迟）
      const data = await getPreloadedData<{ success: boolean; cards?: ArtistCard[] }>(
        `/api/artist-cards?artist=${encodeURIComponent(artist)}`
      );
      if (data.success) {
        setArtistCards(data.cards || []);
      } else {
        setArtistCards([]);
      }
    } catch {
      setArtistCards([]);
      setMatchError("加载画家卡牌失败，请稍后再试");
    } finally {
      setArtistCardsLoading(false);
    }
  }, []);

  async function handleParse() {
    if (!rawText.trim()) return;
    setParsing(true);
    setParseProgress("正在解析名单...");
    try {
      const res = await apiPost("/api/parse-artists", { text: rawText });
      const text = await res.text();

      if (isHtmlResponse(res, text)) {
        setMatchError("浏览器省流模式干扰了解析，请关闭 UC 极速/云端加速后重试");
        setParsing(false);
        setParseProgress("");
        return;
      }

      const data = JSON.parse(text);
      if (data.success) {
        setParsedArtists(data.artists);
        setParseMethod(data.method);
        resetMatchState();

        // 检测解析的画家名单是否与已有活动高度重合，自动勾选匹配的活动
        setParseProgress("正在匹配活动...");
        const matchedEvent = detectMatchingEvent(data.artists, events);
        if (matchedEvent) {
          setCurrentEvent(matchedEvent.name);
          setCurrentEventDate(new Date(matchedEvent.startDate).toLocaleDateString("zh-CN"));
          setSelectedEvents(new Set([matchedEvent.id]));
          showToast(`检测到名单与活动「${matchedEvent.name}」高度重合，已自动关联`, "success");
        } else {
          // 未匹配到活动，清空之前的活动关联
          setCurrentEvent("");
          setCurrentEventDate("");
          setSelectedEvents(new Set());
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[解析] 异常:", msg);
      setParseMethod("");
      setMatchError(`解析失败: ${msg}`);
    } finally {
      setParsing(false);
      setParseProgress("");
    }
  }

  // ─── 状态切换 ──────────────────────────────────────────

  function toggleStatus(cardIdOrIds: string | string[]) {
    // 支持单卡与批量：合并的同款卡牌一次请求完成
    const cardIds = Array.isArray(cardIdOrIds) ? cardIdOrIds : [cardIdOrIds];
    if (cardIds.length === 0) return;
    const idSet = new Set(cardIds);

    // 1. 查找当前状态（合并的同款卡牌状态一致，取第一个命中的）
    // 使用 found 标志区分"找到 status=0 的卡牌"和"未找到卡牌"
    let currentStatus = 0;
    let foundCard = false;
    let oldEventName: string | null = null;
    let oldEventDate: string | null = null;
    const affectedDeckIds = new Set<string>();
    for (const cards of matchedRef.current.values()) {
      const found = cards.find((c) => idSet.has(c.id));
      if (found) {
        currentStatus = found.status ?? 0;
        foundCard = true;
        oldEventName = found.event_name ?? null;
        oldEventDate = found.event_date ?? null;
        affectedDeckIds.add(found.deck_id);
      }
    }
    if (!foundCard) {
      for (const entries of fuzzyMatchedRef.current.values()) {
        const found = entries.find((e) => e.deckCard !== undefined && idSet.has(e.deckCard.id));
        if (found?.deckCard) {
          currentStatus = found.deckCard.status ?? 0;
          oldEventName = found.deckCard.event_name ?? null;
          oldEventDate = found.deckCard.event_date ?? null;
          affectedDeckIds.add(found.deckCard.deck_id);
          break;
        }
      }
    }

    const newStatus = getNextMatchStatus(currentStatus);
    const updatePayload = {
      status: newStatus,
      is_signed: newStatus === 2,
      // 切到心动态时保留卡牌原有活动信息，无则用页面级活动
      event_name: newStatus === 3 ? (oldEventName || (currentEvent || null)) : null,
      event_date: newStatus === 3 ? (oldEventDate || (currentEventDate || null)) : null,
    };

    // 2. 乐观更新：立即更新 UI，用户零延迟感知
    setMatched((prev) => {
      const next = new Map(prev);
      for (const [artist, cards] of next) {
        next.set(
          artist,
          cards.map((c) =>
            idSet.has(c.id)
              ? { ...c, ...updatePayload }
              : c
          )
        );
      }
      return next;
    });

    setFuzzyMatched((prev) => {
      const next = new Map(prev);
      for (const [artist, entries] of next) {
        next.set(
          artist,
          entries.map((e) =>
            e.deckCard && idSet.has(e.deckCard.id)
              ? { ...e, deckCard: { ...e.deckCard, ...updatePayload } }
              : e
          )
        );
      }
      return next;
    });

    // 3. 后台写入数据库（单请求批量），失败则回滚 UI
    apiPost("/api/cards", {
      cardIds,
      status: newStatus,
      is_signed: newStatus === 2,
      event_name: newStatus === 3 ? (oldEventName || (currentEvent || null)) : null,
      event_date: newStatus === 3 ? (oldEventDate || (currentEventDate || null)) : null,
    }, "PATCH")
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          // 回滚到旧状态
          const rollbackPayload = {
            status: currentStatus,
            is_signed: currentStatus === 2,
            event_name: oldEventName,
            event_date: oldEventDate,
          };
          setMatched((prev) => {
            const next = new Map(prev);
            for (const [artist, cards] of next) {
              next.set(
                artist,
                cards.map((c) =>
                  idSet.has(c.id) ? { ...c, ...rollbackPayload } : c
                )
              );
            }
            return next;
          });
          setFuzzyMatched((prev) => {
            const next = new Map(prev);
            for (const [artist, entries] of next) {
              next.set(
                artist,
                entries.map((e) =>
                  e.deckCard && idSet.has(e.deckCard.id)
                    ? { ...e, deckCard: { ...e.deckCard, ...rollbackPayload } }
                    : e
                )
              );
            }
            return next;
          });
          setMatchError(data.error || "状态更新失败，请重试");
        } else {
          // 刷新共享 /api/decks 缓存，确保套牌页统计同步
          refreshDecks();
          // 乐观更新受影响套牌的 /api/cards 缓存，套牌页无需显式刷新即可看到最新状态
          for (const deckId of affectedDeckIds) {
            mutateCards(deckId, (cards) =>
              cards.map((c) =>
                idSet.has(c.id) ? { ...c, ...updatePayload } : c
              )
            );
          }
        }
      })
      .catch(() => {
        // 网络异常，回滚
        const rollbackPayload = {
          status: currentStatus,
          is_signed: currentStatus === 2,
          event_name: oldEventName,
          event_date: oldEventDate,
        };
        setMatched((prev) => {
          const next = new Map(prev);
          for (const [artist, cards] of next) {
            next.set(
              artist,
              cards.map((c) =>
                idSet.has(c.id) ? { ...c, ...rollbackPayload } : c
              )
            );
          }
          return next;
        });
        setFuzzyMatched((prev) => {
          const next = new Map(prev);
          for (const [artist, entries] of next) {
            next.set(
              artist,
              entries.map((e) =>
                e.deckCard && idSet.has(e.deckCard.id)
                  ? { ...e, deckCard: { ...e.deckCard, ...rollbackPayload } }
                  : e
              )
            );
          }
          return next;
        });
        setMatchError("网络异常，状态已恢复");
      });
  }

  // ─── 匹配入口 ──────────────────────────────────────────

  async function handleMatch() {
    const currentSelectedDecks = selectedDecksRef.current;
    const currentParsedArtists = parsedArtistsRef.current;

    if (currentParsedArtists.length === 0 || currentSelectedDecks.size === 0) return;
    if (matchingRef.current) return;
    matchingRef.current = true;

    setMatching(true);
    setHasRun(true);
    setMatchError("");

    try {
      const deckIds = Array.from(currentSelectedDecks);
      if (fuzzyModeRef.current) {
        await handleFuzzyMatch(deckIds);
      } else {
        await handleExactMatch(deckIds);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[匹配] 异常:", msg, err);
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([...currentParsedArtists]);
      setMatchError(`匹配出错: ${msg}`);
    } finally {
      setMatching(false);
      matchingRef.current = false;
    }
  }

  // ─── 精确匹配 ──────────────────────────────────────────

  async function handleExactMatch(deckIds: string[]) {
    const currentParsedArtists = parsedArtistsRef.current;
    const cards = await fetchCardsByDeckIds(deckIds);

    if (cards.length === 0) {
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([...currentParsedArtists]);
      return;
    }

    const artistToCards = new Map<string, CardEntry[]>();
    for (const card of cards) {
      const artists = normalizeArtists(card.artist_names);
      for (const artist of artists) {
        const key = artist.toLowerCase().trim();
        const list = artistToCards.get(key) || [];
        list.push(card);
        artistToCards.set(key, list);
      }
    }

    const newMatched = new Map<string, CardEntry[]>();
    const newUnmatched: string[] = [];
    const dbKeys = [...artistToCards.keys()];
    const normalizedMap = buildNormalizedMap(dbKeys);

    for (const parsedArtist of currentParsedArtists) {
      const matchedKey = findMatchingArtist(parsedArtist, dbKeys, normalizedMap);
      if (matchedKey) {
        newMatched.set(parsedArtist, artistToCards.get(matchedKey) || []);
      } else {
        newUnmatched.push(parsedArtist);
      }
    }

    setMatched(newMatched);
    setFuzzyMatched(new Map());
    setUnmatched(newUnmatched);
  }

  // ─── 模糊匹配 ──────────────────────────────────────────

  async function handleFuzzyMatch(deckIds: string[]) {
    const currentParsedArtists = parsedArtistsRef.current;

    // 1. 并行发起两个独立请求：套牌卡牌查询 + 模糊匹配 API
    //    原先串行等待，总耗时 = 两者之和；并行后 = max(两者)
    const [cards, fuzzyData] = await Promise.all([
      fetchCardsByDeckIds(deckIds),
      callFuzzyApi(deckIds),
    ]);

    if (cards.length === 0) {
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([]);
      return;
    }

    // 2. 构建精确匹配基线（保证模糊 ≥ 精确）
    const { artistCards, exactMatchedKeys, artistDbKeys, artistNormalizedMap } = buildExactBaseline(cards, currentParsedArtists);

    // 4. 构建扩展画家→卡牌映射
    const expandedArtistCards = buildExpandedArtistCards(cards, fuzzyData);

    // 5. 合并精确匹配结果
    mergeExactIntoExpanded(artistCards, exactMatchedKeys, expandedArtistCards);

    // 6. 匹配活动画家
    const { newFuzzyMatched, newUnmatched } = matchAgainstArtists(
      currentParsedArtists,
      expandedArtistCards,
      exactMatchedKeys,
      artistDbKeys,
      artistNormalizedMap,
      artistCards
    );

    setMatched(new Map());
    setFuzzyMatched(newFuzzyMatched);
    setUnmatched(newUnmatched);
  }

  // ─── 模糊匹配子步骤 ────────────────────────────────────

  /** 构建精确匹配基线 Map */
  function buildExactBaseline(cards: CardEntry[], parsedArtists: string[]) {
    const artistCards = new Map<string, CardEntry[]>();
    for (const card of cards) {
      const artists = normalizeArtists(card.artist_names);
      for (const artist of artists) {
        const key = artist.toLowerCase().trim();
        const list = artistCards.get(key) || [];
        list.push(card);
        artistCards.set(key, list);
      }
    }

    const exactMatchedKeys = new Set<string>();
    const artistDbKeys = [...artistCards.keys()];
    const artistNormalizedMap = buildNormalizedMap(artistDbKeys);
    for (const artist of parsedArtists) {
      const matchedKey = findMatchingArtist(artist, artistDbKeys, artistNormalizedMap);
      if (matchedKey) exactMatchedKeys.add(matchedKey);
    }

    return { artistCards, exactMatchedKeys, artistDbKeys, artistNormalizedMap };
  }

  /** 调用模糊匹配 API */
  async function callFuzzyApi(deckIds: string[]): Promise<FuzzyApiResponse> {
    try {
      const fuzzyRes = await apiPost("/api/fuzzy-match", { deckIds });
      const text = await fuzzyRes.text();

      if (isHtmlResponse(fuzzyRes, text)) {
        setMatchError("浏览器省流模式干扰了模糊匹配，请关闭 UC 极速/云端加速后重试");
        return { success: false };
      }

      if (fuzzyRes.ok) return JSON.parse(text);
      console.error(`[模糊匹配] API 返回错误状态: ${fuzzyRes.status}`);
      setMatchError("模糊匹配暂时不可用，已显示精确匹配结果");
    } catch (err: unknown) {
      console.error("[模糊匹配] API 调用异常:", err instanceof Error ? err.message : String(err));
      setMatchError("模糊匹配网络异常，已显示精确匹配结果");
    }
    return { success: false };
  }

  /** 从 API 返回数据构建扩展画家→卡牌映射 */
  function buildExpandedArtistCards(
    cards: CardEntry[],
    fuzzyData: FuzzyApiResponse
  ): Map<string, FuzzyCardEntry[]> {
    const expanded = new Map<string, FuzzyCardEntry[]>();

    const cardsByName = new Map<string, CardEntry[]>();
    for (const card of cards) {
      const arr = cardsByName.get(card.card_name) || [];
      arr.push(card);
      cardsByName.set(card.card_name, arr);
    }

    if (!fuzzyData.success || !fuzzyData.cardMap) return expanded;

    const cardMap = fuzzyData.cardMap as Record<string, {
      card_name: string;
      printings: Array<{ artist: string; set: string; set_name: string; collector_number: string; image_url: string | null; released_at: string }>;
      allArtists: string[];
    }>;

    for (const [cardName, info] of Object.entries(cardMap)) {
      const deckCards = cardsByName.get(cardName) || [];

      for (const printing of info.printings) {
        const artist = printing.artist;
        const existing = expanded.get(artist) || [];

        // 只有印刷版本完全匹配（同系列+同编号）才关联套牌卡牌
        const matchedDeckCard = deckCards.find(
          (dc) => dc.set_code.toLowerCase() === printing.set.toLowerCase() &&
                  String(dc.collector_number) === String(printing.collector_number)
        );

        const entry: FuzzyCardEntry = {
          card_name: cardName,
          set_code: printing.set,
          set_name: printing.set_name,
          collector_number: printing.collector_number,
          image_url: printing.image_url,
          artist,
          deckCard: matchedDeckCard ? { ...matchedDeckCard, artist_names: [artist] } : undefined,
        };

        if (!existing.some((e) => isSamePrinting(e, entry))) {
          existing.push(entry);
        }
        expanded.set(artist, existing);
      }
    }

    return expanded;
  }

  /** 将精确匹配结果并入扩展映射 */
  function mergeExactIntoExpanded(
    artistCards: Map<string, CardEntry[]>,
    exactMatchedKeys: Set<string>,
    expandedArtistCards: Map<string, FuzzyCardEntry[]>
  ) {
    // 预构建规范化键名映射
    const expandedNormKeys = new Map<string, string>();
    for (const ek of expandedArtistCards.keys()) {
      const nk = safeNormalize(ek.toLowerCase().trim());
      if (!expandedNormKeys.has(nk)) expandedNormKeys.set(nk, ek);
    }

    for (const key of exactMatchedKeys) {
      const exactCards = artistCards.get(key) || [];
      if (exactCards.length === 0) continue;
      const displayArtist = normalizeArtists(exactCards[0].artist_names)[0] || key;

      const normalizedDisplay = safeNormalize(displayArtist.toLowerCase().trim());
      const existingKey = expandedNormKeys.get(normalizedDisplay) || null;

      if (!existingKey) {
        expandedArtistCards.set(displayArtist, exactCards.map((c) => ({
          card_name: c.card_name, set_code: c.set_code, set_name: "",
          collector_number: c.collector_number, image_url: c.image_url,
          artist: displayArtist, deckCard: c,
        })));
      } else {
        const existing = expandedArtistCards.get(existingKey)!;
        for (const c of exactCards) {
          if (!existing.some((e) => isSamePrinting(e, c))) {
            existing.push({
              card_name: c.card_name, set_code: c.set_code, set_name: "",
              collector_number: c.collector_number, image_url: c.image_url,
              artist: displayArtist, deckCard: c,
            });
          }
        }
      }
    }
  }

  // ─── 其他操作 ──────────────────────────────────────────

  function toggleDeck(id: string) {
    setSelectedDecks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const exportText = useCallback(() => {
    const currentFuzzyMode = fuzzyModeRef.current;
    const currentFuzzyMatched = fuzzyMatchedRef.current;
    const currentMatched = matchedRef.current;
    const currentParsedArtists = parsedArtistsRef.current;
    const currentDecks = decksRef.current;
    const currentEvents = eventsRef.current;
    const eventName = currentEventRef.current;
    const eventDate = currentEventDateRef.current;

    // 套牌名称映射
    const deckNameMap = new Map(currentDecks.map((d) => [d.id, d.name]));

    // 状态分组顺序：已签 → 送签中 → 心动 → 待签
    const STATUS_GROUPS: Array<{ status: number; label: string }> = [
      { status: 2, label: "已签" },
      { status: 1, label: "送签中" },
      { status: 3, label: "心动" },
      { status: 0, label: "待签" },
    ];

    const date = new Date().toISOString().slice(0, 10);
    let text = "MTG签绘管家 · www.mtgkit.top\n活动签卡清单\n";
    text += `${date} 导出\n\n`;

    // 活动信息
    if (eventName) {
      const eventNames = eventName.split("、");
      text += `活动：${eventName}\n`;
      // 多活动时汇总城市和日期
      const matchedEvents = currentEvents.filter((e) => eventNames.includes(e.name));
      if (matchedEvents.length > 0) {
        const cities = [...new Set(matchedEvents.map((e) => e.city).filter(Boolean))];
        if (cities.length > 0) text += `地点：${cities.join("、")}\n`;
        const dateRanges = matchedEvents.map((e) => {
          const start = new Date(e.startDate).toLocaleDateString("zh-CN");
          if (e.endDate) {
            const end = new Date(e.endDate).toLocaleDateString("zh-CN");
            return `${start} ~ ${end}`;
          }
          return start;
        });
        if (dateRanges.length > 0) text += `日期：${dateRanges.join("；")}\n`;
      } else if (eventDate) {
        text += `日期：${eventDate}\n`;
      }
      text += "\n";
    }

    // 卡牌信息结构
    interface CardInfo {
      label: string;
      count: number;
      status: number;
      deckNames: Map<string, number>;
      eventName: string | null;
      eventDate: string | null;
      inDeck: boolean;
    }

    // 收集所有画家数据
    const artistEntries: Array<{
      artist: string;
      total: number;
      signed: number;
      pending: number;
      heart: number;
      unsigned: number;
      otherVersions: number;
      cards: CardInfo[];
    }> = [];

    if (currentFuzzyMode && currentFuzzyMatched.size > 0) {
      for (const [artist, entries] of currentFuzzyMatched) {
        const grouped = new Map<string, CardInfo>();
        for (const e of entries) {
          const key = `${e.card_name} [${e.set_code.toUpperCase()}]`;
          const st = e.deckCard?.status ?? 0;
          const dn = e.deckCard ? (deckNameMap.get(e.deckCard.deck_id) || e.deckCard.deck_name || "未知套牌") : "";
          const en = e.deckCard?.event_name || null;
          const ed = e.deckCard?.event_date || null;
          const existing = grouped.get(key);
          if (existing) {
            existing.count++;
            if (e.deckCard) {
              existing.inDeck = true;
              existing.deckNames.set(dn, (existing.deckNames.get(dn) || 0) + 1);
              if (st > existing.status) {
                existing.status = st;
                existing.eventName = en;
                existing.eventDate = ed;
              }
            }
          } else {
            const deckNames = new Map<string, number>();
            if (e.deckCard) deckNames.set(dn, 1);
            grouped.set(key, {
              label: key, count: 1, status: st, deckNames,
              eventName: en, eventDate: ed, inDeck: !!e.deckCard,
            });
          }
        }

        const cards = [...grouped.values()];
        const inDeckCards = cards.filter((c) => c.inDeck);
        const countBy = (st: number) => inDeckCards.filter((c) => c.status === st).reduce((s, c) => s + c.count, 0);
        artistEntries.push({
          artist,
          total: inDeckCards.reduce((s, c) => s + c.count, 0),
          signed: countBy(2),
          pending: countBy(1),
          heart: countBy(3),
          unsigned: countBy(0),
          otherVersions: cards.filter((c) => !c.inDeck).reduce((s, c) => s + c.count, 0),
          cards,
        });
      }
    } else {
      for (const [artist, cardList] of currentMatched) {
        const grouped = new Map<string, CardInfo>();
        for (const card of cardList) {
          const key = `${card.card_name} [${card.set_code.toUpperCase()}]`;
          const dn = deckNameMap.get(card.deck_id) || card.deck_name || "未知套牌";
          const existing = grouped.get(key);
          if (existing) {
            existing.count++;
            existing.deckNames.set(dn, (existing.deckNames.get(dn) || 0) + 1);
            if (card.status > existing.status) {
              existing.status = card.status;
              existing.eventName = card.event_name || null;
              existing.eventDate = card.event_date || null;
            }
          } else {
            const deckNames = new Map<string, number>();
            deckNames.set(dn, 1);
            grouped.set(key, {
              label: key, count: 1, status: card.status, deckNames,
              eventName: card.event_name || null, eventDate: card.event_date || null,
              inDeck: true,
            });
          }
        }

        const cards = [...grouped.values()];
        const countBy = (st: number) => cards.filter((c) => c.status === st).reduce((s, c) => s + c.count, 0);
        artistEntries.push({
          artist,
          total: cards.reduce((s, c) => s + c.count, 0),
          signed: countBy(2),
          pending: countBy(1),
          heart: countBy(3),
          unsigned: countBy(0),
          otherVersions: 0,
          cards,
        });
      }
    }

    // 排序：有待签的在前，全部已签的在后
    artistEntries.sort((a, b) => {
      const aToSign = a.unsigned + a.pending + a.heart;
      const bToSign = b.unsigned + b.pending + b.heart;
      if (aToSign > 0 && bToSign === 0) return -1;
      if (aToSign === 0 && bToSign > 0) return 1;
      return 0;
    });

    // 汇总行
    const totalCards = artistEntries.reduce((s, a) => s + a.total, 0);
    const totalSigned = artistEntries.reduce((s, a) => s + a.signed, 0);
    const totalPending = artistEntries.reduce((s, a) => s + a.pending, 0);
    const totalHeart = artistEntries.reduce((s, a) => s + a.heart, 0);
    const totalUnsigned = artistEntries.reduce((s, a) => s + a.unsigned, 0);
    const pct = totalCards > 0 ? Math.round((totalSigned / totalCards) * 100) : 0;

    const summaryParts: string[] = [`共 ${artistEntries.length} 位画家`];
    if (totalCards > 0) summaryParts.push(`${totalCards} 张卡牌`);
    if (totalSigned > 0) summaryParts.push(`已签 ${totalSigned}（${pct}%）`);
    if (totalPending > 0) summaryParts.push(`送签中 ${totalPending}`);
    if (totalHeart > 0) summaryParts.push(`心动 ${totalHeart}`);
    if (totalUnsigned > 0) summaryParts.push(`待签 ${totalUnsigned}`);
    text += summaryParts.join(" · ") + "\n\n";

    // 每位画家
    for (const entry of artistEntries) {
      const progressParts: string[] = [`${entry.total} 张`];
      if (entry.signed > 0) progressParts.push(`已签 ${entry.signed}`);
      if (entry.pending > 0) progressParts.push(`送签中 ${entry.pending}`);
      if (entry.heart > 0) progressParts.push(`心动 ${entry.heart}`);
      if (entry.unsigned > 0) progressParts.push(`待签 ${entry.unsigned}`);
      if (entry.otherVersions > 0) progressParts.push(`其他版本 ${entry.otherVersions}`);

      text += `${entry.artist}（${progressParts.join(" · ")}）\n`;

      // 按状态分组显示
      for (const group of STATUS_GROUPS) {
        const groupCards = entry.cards.filter((c) => c.inDeck && c.status === group.status);
        if (groupCards.length === 0) continue;

        text += `  【${group.label}】\n`;
        for (const card of groupCards) {
          const countStr = card.count > 1 ? ` ×${card.count}` : "";
          // 多套牌时显示套牌名（不显示套牌内张数）
          const deckStr = [...card.deckNames.keys()].join(", ");
          const line = `    ${card.label}${countStr} — ${deckStr}`;
          text += line + "\n";
        }
      }

      // 其他版本（仅模糊模式）
      if (currentFuzzyMode) {
        const otherCards = entry.cards.filter((c) => !c.inDeck);
        if (otherCards.length > 0) {
          text += `  【其他版本】\n`;
          for (const card of otherCards) {
            const countStr = card.count > 1 ? ` ×${card.count}` : "";
            text += `    ${card.label}${countStr}\n`;
          }
        }
      }

      text += "\n";
    }

    // 完整活动画家名单
    if (currentParsedArtists.length > 0) {
      text += `\n完整活动名单（${currentParsedArtists.length} 位）：\n`;
      text += currentParsedArtists.join("、") + "\n";
    }

    const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mtg-signing-list-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    fuzzyModeRef,
    fuzzyMatchedRef,
    matchedRef,
    parsedArtistsRef,
    decksRef,
    eventsRef,
    currentEventRef,
    currentEventDateRef,
  ]);

  // ─── 渲染 ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">活动匹配</h1>
          <p className="text-muted-foreground">填入画家名单，匹配你的套牌</p>
        </div>
      </div>

      {/* 第一步：粘贴 + 解析 */}
      <Card>
        <CardHeader>
          <CardTitle>1. 填入画家名单</CardTitle>
          <CardDescription>粘贴画家名单，或从下方活动日历中多选活动</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 多选活动下拉 */}
          <div className="relative">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-background text-sm hover:bg-accent/50 transition-colors"
              onClick={() => setEventsOpen(!eventsOpen)}
            >
              <span className={selectedEvents.size > 0 ? "text-foreground" : "text-muted-foreground"}>
                {selectedEvents.size > 0
                  ? `已选 ${selectedEvents.size} 个活动（${parsedArtists.length} 位画家）`
                  : "选择活动自动填充画家名单（可多选）..."}
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${eventsOpen ? "rotate-180" : ""}`} />
            </button>

            {eventsOpen && (
              <div className="absolute z-10 mt-1 w-full bg-background border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {events.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">暂无活动</div>
                ) : (
                  events.map((e) => {
                    const isSelected = selectedEvents.has(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent/50 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                        onClick={() => toggleEvent(e.id)}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="whitespace-normal leading-relaxed">
                          {new Date(e.startDate).toLocaleDateString("zh-CN")} | {e.name} ({e.city}) — {e.artists.length} 位画家
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* 已选活动标签 */}
          {selectedEvents.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {[...selectedEvents].map((id) => {
                const event = events.find((e) => e.id === id);
                if (!event) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs"
                  >
                    {event.name}
                    <button
                      type="button"
                      onClick={() => toggleEvent(id)}
                      className="hover:bg-primary/20 rounded-sm p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <Textarea
            placeholder={"粘贴活动画家名单，支持多种格式，例如：\n1. John Avon  $6/$12\n2. Rebecca Guay  $6/$12\n\n"}
            rows={6}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="text-sm"
          />
          <div className="flex items-center gap-3">
            <Button
                size="sm"
                onClick={handleParse}
                disabled={parsing || !rawText.trim()}
              >
                <Search className="h-4 w-4 mr-2" />
                智能解析
              </Button>
            {parsing && parseProgress && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {parseProgress}
              </span>
            )}
            {!parsing && parseMethod && (
              <span className="text-xs text-muted-foreground">
                已解析 {parsedArtists.length} 位画家 ({parseMethod})
              </span>
            )}
          </div>

          {parsedArtists.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 bg-accent/50 rounded-lg">
              {parsedArtists.map((a) => (
                <Button
                  key={a}
                  variant="outline"
                  size="sm"
                  className="border-border text-muted-foreground hover:bg-accent"
                  onClick={() => handleArtistClick(a)}
                  onMouseEnter={() => preloadData(`/api/artist-cards?artist=${encodeURIComponent(a)}`)}
                >
                  {a}
                </Button>
              ))}
            </div>
          )}
          {matchError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
              {matchError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 第二步：选择套牌 + 匹配 */}
      <Card>
        <CardHeader>
          <CardTitle>2. 选择套牌并匹配</CardTitle>
          <CardDescription>选择需要比对的套牌，点击开始匹配</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {decks.map((deck) => (
              <Button
                key={deck.id}
                variant="outline"
                size="sm"
                className={selectedDecks.has(deck.id) ? "border-primary bg-primary/10 text-primary hover:bg-primary/20" : "border-border text-muted-foreground hover:bg-accent"}
                onClick={() => toggleDeck(deck.id)}
              >
                {selectedDecks.has(deck.id) ? <CheckSquare className="h-4 w-4 mr-2" /> : <Square className="h-4 w-4 mr-2" />}
                {deck.name}
              </Button>
            ))}
            {decks.length === 0 && <p className="text-sm text-muted-foreground">暂无套牌，请先导入套牌</p>}
          </div>

          <div className="flex items-center gap-3">
            <Button
                size="sm"
                onClick={handleMatch}
                disabled={matching || parsedArtists.length === 0 || selectedDecks.size === 0}
              >
                <Play className="h-4 w-4 mr-2" />
                开始匹配
              </Button>
            <Button
                variant="outline"
                size="sm"
                className={fuzzyMode ? "border-primary bg-primary/10 text-primary hover:bg-primary/20" : "border-border text-muted-foreground hover:bg-accent"}
                onClick={() => setFuzzyMode(!fuzzyMode)}
              >
                {fuzzyMode ? <Sparkles className="h-3.5 w-3.5 mr-1.5" /> : <Sparkle className="h-3.5 w-3.5 mr-1.5" />}
                模糊匹配
              </Button>
          </div>
          {fuzzyMode && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              <Sparkles className="h-3 w-3 inline mr-1" />
              模糊匹配会搜索每张卡牌的<strong>所有印刷版本</strong>，扩大匹配范围<br />
              例如：套牌中有异画版「脑力激荡」，开启后将匹配<strong>所有画过该牌的画家</strong>
            </p>
          )}
        </CardContent>
      </Card>

      {/* 匹配结果 */}
      {hasRun && (
        <MatchResultCard
          fuzzyMode={fuzzyMode}
          matching={matching}
          matched={matched}
          fuzzyMatched={fuzzyMatched}
          unmatched={unmatched}
          parsedArtists={parsedArtists}
          displayMode={displayMode}
          toggleStatus={toggleStatus}
          exportText={exportText}
        />
      )}

      {/* 画家卡牌画廊弹窗（懒加载，打开时才下载 chunk）*/}
      {artistDialog !== null && (
        <ArtistGalleryDialog
          artist={artistDialog}
          cards={artistCards}
          loading={artistCardsLoading}
          onClose={() => { setArtistDialog(null); setArtistCards([]); }}
        />
      )}
    </div>
  );
}

// ─── 子组件 ──────────────────────────────────────────────

interface MatchResultCardProps {
  fuzzyMode: boolean;
  matching: boolean;
  matched: Map<string, CardEntry[]>;
  fuzzyMatched: Map<string, FuzzyCardEntry[]>;
  unmatched: string[];
  parsedArtists: string[];
  displayMode: "individual" | "grouped";
  toggleStatus: (cardIdOrIds: string | string[]) => void;
  exportText: () => void;
}

function MatchResultCard({
  fuzzyMode, matching, matched, fuzzyMatched, unmatched, parsedArtists, displayMode, toggleStatus, exportText,
}: MatchResultCardProps) {
  const activeMatched = fuzzyMode ? fuzzyMatched : matched;
  const matchedCount = activeMatched.size;

  let totalCards = 0;
  if (fuzzyMode) {
    for (const entries of fuzzyMatched.values()) totalCards += entries.length;
  } else {
    for (const cards of matched.values()) totalCards += cards.length;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              匹配结果
              {fuzzyMode && (
                <span className="ml-2 text-sm font-normal text-amber-500">
                  <Sparkles className="h-4 w-4 inline mr-1" />模糊模式
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {matching ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />正在匹配中...
                </span>
              ) : (
                <>匹配 {matchedCount}/{parsedArtists.length} 位画家{matchedCount > 0 && ` · 共 ${totalCards} 个版本`}</>
              )}
            </CardDescription>
          </div>
          {!matching && matchedCount > 0 && (
            <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/20" onClick={exportText}>
              <Download className="h-4 w-4 mr-2" />导出清单
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {matching ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <p>{fuzzyMode ? "正在查询所有印刷版本..." : "正在匹配画家..."}</p>
          </div>
        ) : matchedCount === 0 ? (
          <p className="text-muted-foreground text-center py-8">没有匹配到任何卡牌，请检查活动名单与套牌选择是否正确</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-3">
              <Lightbulb className="h-3.5 w-3.5 shrink-0" />
              点击卡牌可切换状态：未签 → 心动 → 送签中
            </p>
            {fuzzyMode ? (
              <FuzzyMatchResults fuzzyMatched={fuzzyMatched} toggleStatus={toggleStatus} />
            ) : (
              <ExactMatchResults matched={matched} displayMode={displayMode} toggleStatus={toggleStatus} />
            )}
          </>
        )}

        {!matching && unmatched.length > 0 && (
          <div className="pt-4 border-t mt-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">以下画家出席，但你暂无待签卡牌：</h4>
            <div className="flex flex-wrap gap-2">
              {unmatched.map((a) => (
                <span key={a} className="px-2 py-1 bg-accent text-muted-foreground rounded text-sm line-through">{a}</span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 精确匹配结果 ──────────────────────────────────────────

/** 合并相同卡牌（同名+同系列+同编号+同状态），返回 { card, count, ids } */
function mergeCards(
  cardList: CardEntry[]
): Array<{ card: CardEntry; count: number; ids: string[] }> {
  // 合并 key 包含 status，不同状态的卡牌分开显示
  const key = (c: CardEntry) => `${c.card_name}|${c.set_code}|${c.collector_number}|${c.status ?? 0}`;
  const groups = new Map<string, { card: CardEntry; count: number; ids: string[] }>();

  for (const card of cardList) {
    const k = key(card);
    const existing = groups.get(k);
    if (existing) {
      existing.count++;
      existing.ids.push(card.id);
    } else {
      groups.set(k, { card, count: 1, ids: [card.id] });
    }
  }

  return Array.from(groups.values());
}

function ExactMatchResults({ matched, displayMode, toggleStatus }: {
  matched: Map<string, CardEntry[]>;
  displayMode: "individual" | "grouped";
  toggleStatus: (cardIdOrIds: string | string[]) => void;
}) {
  // 全局首屏优先加载计数器：跨所有画家/套牌组只让前 8 张卡牌 priority
  let priorityCount = 0;

  return (
    <div className="space-y-6">
      {Array.from(matched).map(([artist, cards]) => (
        <div key={artist}>
          <h3 className="text-base font-semibold mb-3 flex items-center gap-1">
            <Palette className="h-4 w-4 text-foreground shrink-0" /> {artist} ← 出席！<span className="ml-2 text-base font-normal text-muted-foreground">({cards.length} 张)</span>
          </h3>
          {(() => {
            const byDeck = new Map<string, CardEntry[]>();
            for (const c of cards) {
              const d = c.deck_name || "未知套牌";
              const arr = byDeck.get(d) || [];
              arr.push(c);
              byDeck.set(d, arr);
            }
            return Array.from(byDeck).map(([deckName, deckCards]) => {
              // 合并模式：相同卡牌（同名+同系列+同编号）合并
              const displayCards =
                displayMode === "grouped"
                  ? mergeCards(deckCards)
                  : deckCards.map((c) => ({ card: c, count: 1, ids: [c.id] }));

              return (
                <div key={deckName} className="mb-3">
                  <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><Package className="h-3.5 w-3.5" /> {deckName}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
                    {displayCards.map((group) => {
                      const isPriority = priorityCount < 8;
                      priorityCount++;
                      return (
                        <CardThumbnail
                          key={group.ids[0]}
                          cardId={group.ids[0]}
                          imageUrl={group.card.image_url}
                          cardName={group.card.card_name}
                          status={group.card.status}
                          count={group.count}
                          allIds={group.ids}
                          toggleStatus={toggleStatus}
                          priority={isPriority}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      ))}
    </div>
  );
}

// ─── 模糊匹配结果 ──────────────────────────────────────────

function FuzzyMatchResults({ fuzzyMatched, toggleStatus }: { fuzzyMatched: Map<string, FuzzyCardEntry[]>; toggleStatus: (cardIdOrIds: string | string[]) => void }) {
  // 全局首屏优先加载计数器：跨所有画家/卡牌组只让前 8 张卡牌 priority
  let priorityCount = 0;

  return (
    <div className="space-y-6">
      {Array.from(fuzzyMatched).map(([artist, entries]) => {
        const byCardName = new Map<string, FuzzyCardEntry[]>();
        for (const e of entries) {
          const arr = byCardName.get(e.card_name) || [];
          arr.push(e);
          byCardName.set(e.card_name, arr);
        }

        return (
          <div key={artist}>
            <h3 className="text-base font-semibold mb-3 flex items-center gap-1">
              <Palette className="h-4 w-4 text-foreground shrink-0" /> {artist} ← 出席！
              <span className="ml-2 text-base font-normal text-muted-foreground">
                ({entries.length} 个版本)
              </span>
            </h3>

            {Array.from(byCardName).map(([cardName, versions]) => (
              <div key={cardName} className="mb-3">
                <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><Package className="h-3.5 w-3.5" /> {cardName}</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
                  {versions.map((v, idx) => {
                    const isInDeck = !!v.deckCard;
                    const cardId = v.deckCard?.id;
                    const status = v.deckCard?.status ?? 0;
                    const isPriority = priorityCount < 8;
                    priorityCount++;

                    return (
                      <div
                        key={v.set_code + "-" + v.collector_number + "-" + idx}
                        onClick={() => { if (cardId) toggleStatus(cardId); }}
                        className={"relative w-full rounded-lg overflow-hidden border transition-all hover:scale-105 " + (isInDeck ? "cursor-pointer hover:shadow-md" : "cursor-default opacity-60") + " " + statusBorderClass(isInDeck, status)}
                        title={isInDeck ? { 0: "待签", 1: "送签中", 2: "已签", 3: "心动" }[status] : "其他版本"}
                      >
                        <div className={isInDeck && status >= 1 ? "opacity-75" : ""}>
                          {v.image_url ? (
                            <CardImage src={v.image_url} alt={v.card_name} className="w-full" priority={isPriority} />
                          ) : (
                            <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                              {v.card_name}
                            </div>
                          )}
                        </div>
                        <StatusBadge status={status} isInDeck={isInDeck} />
                        {!isInDeck && (
                          <div className="absolute top-0 right-0 bg-amber-500 text-white text-xs px-1 rounded-bl">其他</div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-1 py-0.5 text-center leading-tight truncate">
                          {v.set_code.toUpperCase()} #{v.collector_number}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── 共享组件 ──────────────────────────────────────────────

/** 状态圆点标记，CardThumbnail 和 FuzzyMatchResults 共用 */
function StatusBadge({ status, isInDeck }: { status: number; isInDeck: boolean }) {
  if (!isInDeck || status < 1) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className={"w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg -translate-y-2 " + (status === 3 ? "bg-pink-500" : status === 1 ? "bg-blue-500" : status === 2 ? "bg-green-600" : "bg-green-500")}>
        {status === 3 ? <Heart className="h-4 w-4" /> : status === 1 ? <MoreHorizontal className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      </div>
    </div>
  );
}

/** 状态对应的边框样式 */
function statusBorderClass(isInDeck: boolean, status: number): string {
  if (!isInDeck) return "border-border border-dashed";
  if (status === 3) return "border-pink-400 ring-1 ring-pink-400";
  if (status === 1) return "border-blue-400 ring-1 ring-blue-400";
  if (status === 2) return "border-green-500 ring-1 ring-green-500";
  return "border-border";
}

// ─── 卡牌缩略图（精确匹配用） ──────────────────────────────

function CardThumbnail({
  cardId, imageUrl, cardName, status, count = 1, allIds, toggleStatus, priority = false,
}: {
  cardId: string;
  imageUrl: string | null;
  cardName: string;
  status: number;
  count?: number;
  allIds?: string[];
  toggleStatus: (cardIdOrIds: string | string[]) => void;
  /** 首屏可见的图片传 true，提升 LCP */
  priority?: boolean;
}) {
  function handleToggle() {
    const ids = allIds && allIds.length > 0 ? allIds : [cardId];
    // 批量发送：一次 API 请求更新所有同款卡牌，避免逐个请求的竞态和性能问题
    toggleStatus(ids);
  }

  return (
    <div className="group relative w-full">
      <div
        onClick={handleToggle}
        className={"relative rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 " + (status >= 1 ? (status === 3 ? "border-pink-400" : status === 1 ? "border-blue-400" : "border-green-500") : "border-border hover:shadow-md")}
        title={{ 0: "待签", 1: "送签中", 2: "已签", 3: "心动" }[status ?? 0]}
      >
        <div className={status >= 1 ? "opacity-75" : ""}>
          {imageUrl ? (
            <CardImage src={imageUrl} alt={cardName} className="w-full" priority={priority} />
          ) : (
            <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {cardName}
            </div>
          )}
        </div>
        <StatusBadge status={status} isInDeck={true} />
        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-1 py-0.5 text-center leading-tight truncate">
          {cardName}
        </div>
      </div>

      {/* 合并按钮：数量 — 右上角，圆角与卡牌一致 */}
      {count > 1 && (
        <div className="absolute top-0.5 right-0.5 z-20 h-6 bg-background/80 border border-border shadow-sm flex items-center justify-center px-1 rounded-lg">
          <span className="text-xs font-bold text-foreground leading-tight">×{count}</span>
        </div>
      )}
    </div>
  );
}