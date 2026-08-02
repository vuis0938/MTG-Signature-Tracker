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
import { useDecks } from "@/lib/swr-hooks";
import { Search, Play, Download, CheckSquare, Square, Loader2, Sparkles, Sparkle, Palette, Package, Heart, Check, MoreHorizontal, Lightbulb } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from "@/components/ui/dialog";

// ─── 类型定义 ──────────────────────────────────────────────

import type { Deck, CardEntry, FuzzyCardEntry, ArtistCard, CalendarEvent } from "@/types";
import { normalizeArtists, buildNormalizedMap, findMatchingArtist, isSamePrinting, getNextStatus, matchAgainstArtists } from "@/lib/match-utils";
import type { FuzzyApiResponse } from "@/lib/match-utils";

// ─── 页面组件 ──────────────────────────────────────────────

export default function MatchClient() {
  // 名单解析
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedArtists, setParsedArtists] = useState<string[]>([]);
  const [parseMethod, setParseMethod] = useState("");

  // 套牌选择 — SWR 获取，跨页面共享缓存
  const { decks } = useDecks();
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());

  // decks 加载后默认全选
  useEffect(() => {
    if (decks.length > 0 && selectedDecks.size === 0) {
      setSelectedDecks(new Set(decks.map((d) => d.id)));
    }
  }, [decks, selectedDecks.size]);

  // 活动列表
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

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

  // 画家卡牌弹窗
  const [artistDialog, setArtistDialog] = useState<string | null>(null);
  const [artistCards, setArtistCards] = useState<ArtistCard[]>([]);
  const [artistCardsLoading, setArtistCardsLoading] = useState(false);

  const [hasRun, setHasRun] = useState(false);

  // Toast
  const { toast: showToast } = useToast();

  // Ref 锁定最新状态，避免闭包陷阱
  const selectedDecksRef = useRef(selectedDecks);
  selectedDecksRef.current = selectedDecks;
  const parsedArtistsRef = useRef(parsedArtists);
  parsedArtistsRef.current = parsedArtists;
  const decksRef = useRef(decks);
  decksRef.current = decks;
  const fuzzyModeRef = useRef(fuzzyMode);
  fuzzyModeRef.current = fuzzyMode;
  const matchingRef = useRef(false);
  const eventsLoadedRef = useRef(false);
  const matchedRef = useRef(matched);
  matchedRef.current = matched;
  const fuzzyMatchedRef = useRef(fuzzyMatched);
  fuzzyMatchedRef.current = fuzzyMatched;

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
    const currentDecks = decksRef.current;
    const deckMap = new Map(currentDecks.map((d) => [d.id, d.name]));

    try {
      const res = await fetch("/api/cards/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckIds }),
      });
      const data = await res.json();
      if (data.success && data.cards) {
        return data.cards as CardEntry[];
      }
      return [];
    } catch (err: unknown) {
      console.error(`[查询] 套牌查询异常:`, err);
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

  async function loadEvents(): Promise<CalendarEvent[]> {
    if (eventsLoadedRef.current) return events;
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (data.success) {
        setEvents(data.events);
        eventsLoadedRef.current = true;
        return data.events as CalendarEvent[];
      }
    } catch {
      eventsLoadedRef.current = false;
    } finally {
      setLoadingEvents(false);
    }
    return [];
  }

  function selectEvent(eventId: string) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    setRawText(event.artists.join("\n"));
    setParsedArtists(event.artists);
    setParseMethod("活动日历");
    setCurrentEvent(event.name);
    setCurrentEventDate(new Date(event.startDate).toLocaleDateString("zh-CN"));
    resetMatchState();
  }

  const handleArtistClick = useCallback(async (artist: string) => {
    setArtistDialog(artist);
    setArtistCards([]);
    setArtistCardsLoading(true);

    try {
      const res = await fetch(`/api/artist-cards?artist=${encodeURIComponent(artist)}`);
      const data = await res.json();
      if (data.success) {
        setArtistCards(data.cards);
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
    try {
      // 确保活动列表已加载（用于后续重合度检测）
      const currentEvents = eventsLoadedRef.current ? events : await loadEvents();

      const res = await fetch("/api/parse-artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      });
      const data = await res.json();
      if (data.success) {
        setParsedArtists(data.artists);
        setParseMethod(data.method);
        resetMatchState();

        // 检测解析的画家名单是否与已有活动高度重合
        const matchedEvent = detectMatchingEvent(data.artists, currentEvents);
        if (matchedEvent) {
          setCurrentEvent(matchedEvent.name);
          setCurrentEventDate(new Date(matchedEvent.startDate).toLocaleDateString("zh-CN"));
          showToast(`检测到名单与活动「${matchedEvent.name}」高度重合，已自动关联`, "success");
        } else {
          // 未匹配到活动，清空之前的活动关联
          setCurrentEvent("");
          setCurrentEventDate("");
        }
      }
    } catch {
      setParseMethod("");
      setMatchError("解析失败，请检查名单格式后重试");
    } finally {
      setParsing(false);
    }
  }

  // ─── 状态切换 ──────────────────────────────────────────

  async function toggleStatus(cardId: string) {
    // 1. 查找当前状态
    let currentStatus = 0;
    for (const cards of matchedRef.current.values()) {
      const found = cards.find((c) => c.id === cardId);
      if (found) { currentStatus = found.status; break; }
    }
    if (currentStatus === 0) {
      for (const entries of fuzzyMatchedRef.current.values()) {
        const found = entries.find((e) => e.deckCard?.id === cardId);
        if (found?.deckCard) { currentStatus = found.deckCard.status; break; }
      }
    }

    const newStatus = getNextStatus(currentStatus);
    const updatePayload = {
      status: newStatus,
      is_signed: false,
      event_name: newStatus === 3 ? currentEvent : null,
      event_date: newStatus === 3 ? currentEventDate : null,
    };

    // 2. 先写数据库，成功后再更新 UI（避免乐观更新不一致）
    try {
      const res = await fetch("/api/cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          status: newStatus,
          is_signed: false,
          event_name: newStatus === 3 ? currentEvent : null,
          event_date: newStatus === 3 ? currentEventDate : null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error("[toggleStatus] 更新失败");
        setMatchError("状态更新失败，请刷新页面重试");
        return;
      }
    } catch (err: unknown) {
      console.error("[toggleStatus] 网络异常:", err);
      setMatchError("状态更新失败，请刷新页面重试");
      return;
    }

    // 3. 数据库写入成功后更新 UI
    setMatched((prev) => {
      const next = new Map(prev);
      for (const [artist, cards] of next) {
        next.set(
          artist,
          cards.map((c) =>
            c.id === cardId
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
            e.deckCard?.id === cardId
              ? { ...e, deckCard: { ...e.deckCard, ...updatePayload } }
              : e
          )
        );
      }
      return next;
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
      console.error("[匹配] 异常:", err);
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([...currentParsedArtists]);
      setMatchError("匹配过程出错，请重试");
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

    // 1. 查询套牌卡牌
    const cards = await fetchCardsByDeckIds(deckIds);

    if (cards.length === 0) {
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([]);
      return;
    }

    // 2. 构建精确匹配基线（保证模糊 ≥ 精确）
    const { artistCards, exactMatchedKeys, artistDbKeys, artistNormalizedMap } = buildExactBaseline(cards, currentParsedArtists);

    // 3. 调用模糊匹配 API
    const fuzzyData = await callFuzzyApi(deckIds);

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
      const fuzzyRes = await fetch("/api/fuzzy-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckIds }),
      });
      if (fuzzyRes.ok) return await fuzzyRes.json();
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
      const deckCard = deckCards.length > 0 ? deckCards[0] : undefined;

      for (const printing of info.printings) {
        const artist = printing.artist;
        const existing = expanded.get(artist) || [];

        const entry: FuzzyCardEntry = {
          card_name: cardName,
          set_code: printing.set,
          set_name: printing.set_name,
          collector_number: printing.collector_number,
          image_url: printing.image_url,
          artist,
          deckCard: deckCard ? { ...deckCard, artist_names: [artist] } : undefined,
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
      const nk = ek.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!expandedNormKeys.has(nk)) expandedNormKeys.set(nk, ek);
    }

    for (const key of exactMatchedKeys) {
      const exactCards = artistCards.get(key) || [];
      if (exactCards.length === 0) continue;
      const displayArtist = normalizeArtists(exactCards[0].artist_names)[0] || key;

      const normalizedDisplay = displayArtist.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
    const currentUnmatched = unmatched;

    let text = "MTG 签绘管家 · 活动准备清单\n";
    text += "=".repeat(40) + "\n\n";

    if (currentFuzzyMode && currentFuzzyMatched.size > 0) {
      for (const [artist, entries] of currentFuzzyMatched) {
        text += `${artist} (${entries.length} 个版本)\n`;
        const byName = new Map<string, FuzzyCardEntry[]>();
        for (const e of entries) {
          const arr = byName.get(e.card_name) || [];
          arr.push(e);
          byName.set(e.card_name, arr);
        }
        for (const [cardName, versions] of byName) {
          for (const v of versions) {
            const inDeck = v.deckCard ? " [套牌中]" : " [其他版本]";
            text += `  - ${cardName} [${v.set_code.toUpperCase()}] #${v.collector_number}${inDeck}\n`;
          }
        }
        text += "\n";
      }
    } else {
      for (const [artist, cards] of currentMatched) {
        text += `${artist} (${cards.length} 张)\n`;
        for (const card of cards) {
          text += `  - ${card.card_name} [${card.set_code.toUpperCase()}] ${card.deck_name}\n`;
        }
        text += "\n";
      }
    }

    if (currentUnmatched.length > 0) {
      text += "─".repeat(40) + "\n";
      text += "以下画家出席，但你暂无待签卡牌：\n";
      currentUnmatched.forEach((a) => (text += `  - ${a}\n`));
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mtg-signing-list.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [unmatched]);

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
          <CardDescription>粘贴画家名单，或从下方活动日历中一键选取</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm appearance-none whitespace-normal overflow-hidden bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23666%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-8"
            defaultValue=""
            onChange={(e) => { if (e.target.value) selectEvent(e.target.value); }}
            onFocus={() => { if (events.length === 0) loadEvents(); }}
          >
            <option value="" disabled>
              {loadingEvents ? "加载中..." : "选择活动自动填充画家名单..."}
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {new Date(e.startDate).toLocaleDateString("zh-CN")} | {e.name} ({e.city}) — {e.artists.length} 位画家
              </option>
            ))}
          </select>

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
            {parseMethod && (
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

      {/* 画家卡牌画廊弹窗 */}
      <Dialog
        open={artistDialog !== null}
        onOpenChange={() => { setArtistDialog(null); setArtistCards([]); }}
        className="max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{artistDialog} 的卡牌</DialogTitle>
        </DialogHeader>
        {artistCardsLoading ? (
          <DialogContent>
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
            </div>
          </DialogContent>
        ) : (
          <DialogContent>
            {artistCards.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">未找到该画家的卡牌</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-[65vh] overflow-y-auto pr-2">
                {artistCards.map((card) => (
                  <div
                    key={card.set + "-" + card.collector_number}
                    className="rounded-lg border overflow-hidden bg-background"
                    title={card.set_name + " #" + card.collector_number}
                  >
                    {card.image_url ? (
                      <CardImage src={card.image_url} alt={card.name} className="w-full" />
                    ) : (
                      <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        {card.name}
                      </div>
                    )}
                    <div className="p-1.5 text-xs">
                      <p className="font-medium truncate">{card.name}</p>
                      <p className="text-muted-foreground truncate">{card.set_name} #{card.collector_number}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
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
  toggleStatus: (cardId: string) => void;
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

/** 合并相同卡牌（同名+同系列+同编号），返回 { card, count, ids } */
function mergeCards(
  cardList: CardEntry[]
): Array<{ card: CardEntry; count: number; ids: string[] }> {
  const key = (c: CardEntry) => `${c.card_name}|${c.set_code}|${c.collector_number}`;
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
  toggleStatus: (cardId: string) => void;
}) {
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
                    {displayCards.map((group) => (
                      <CardThumbnail
                        key={group.ids[0]}
                        cardId={group.ids[0]}
                        imageUrl={group.card.image_url}
                        cardName={group.card.card_name}
                        status={group.card.status}
                        count={group.count}
                        allIds={group.ids}
                        toggleStatus={toggleStatus}
                      />
                    ))}
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

function FuzzyMatchResults({ fuzzyMatched, toggleStatus }: { fuzzyMatched: Map<string, FuzzyCardEntry[]>; toggleStatus: (cardId: string) => void }) {
  return (
    <div className="space-y-6">
      {Array.from(fuzzyMatched).map(([artist, entries]) => {
        const byCardName = new Map<string, FuzzyCardEntry[]>();
        for (const e of entries) {
          const arr = byCardName.get(e.card_name) || [];
          arr.push(e);
          byCardName.set(e.card_name, arr);
        }
        const deckCount = entries.filter((e) => e.deckCard).length;

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

                    return (
                      <div
                        key={v.set_code + "-" + v.collector_number + "-" + idx}
                        onClick={() => { if (cardId) toggleStatus(cardId); }}
                        className={"relative w-full rounded-lg overflow-hidden border transition-all hover:scale-105 " + (isInDeck ? "cursor-pointer hover:shadow-md" : "cursor-default opacity-60") + " " + statusBorderClass(isInDeck, status)}
                        title={isInDeck ? { 0: "待签", 1: "送签中", 2: "已签", 3: "心动" }[status] : "其他版本"}
                      >
                        <div className={isInDeck && status >= 1 ? "opacity-75" : ""}>
                          {v.image_url ? (
                            <CardImage src={v.image_url} alt={v.card_name} className="w-full" />
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
  cardId, imageUrl, cardName, status, count = 1, allIds, toggleStatus,
}: {
  cardId: string;
  imageUrl: string | null;
  cardName: string;
  status: number;
  count?: number;
  allIds?: string[];
  toggleStatus: (cardId: string) => void;
}) {
  function handleToggle() {
    const ids = allIds && allIds.length > 0 ? allIds : [cardId];
    for (const id of ids) {
      toggleStatus(id);
    }
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
            <CardImage src={imageUrl} alt={cardName} className="w-full" />
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