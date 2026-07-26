"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/user";
import { Search, Download, CheckSquare, Square, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from "@/components/ui/dialog";

// ─── 类型定义 ──────────────────────────────────────────────

import type { Deck, CardEntry, FuzzyCardEntry, ArtistCard, CalendarEvent } from "@/types";
import { normalizeArtists, buildNormalizedMap, findMatchingArtist, isSamePrinting, getNextStatus } from "@/lib/match-utils";
import type { FuzzyApiResponse } from "@/lib/match-utils";

// ─── 页面组件 ──────────────────────────────────────────────

export default function MatchPage() {
  // 名单解析
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedArtists, setParsedArtists] = useState<string[]>([]);
  const [parseMethod, setParseMethod] = useState("");

  // 套牌选择
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());

  // 活动列表
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // 匹配
  const [matching, setMatching] = useState(false);
  const [fuzzyMode, setFuzzyMode] = useState(false);
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

  // 调试面板
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [rawDataPanel, setRawDataPanel] = useState<Array<{
    deckName: string; cardName: string; setCode: string; artists: string[]; status: number; deckId: string;
  }>>([]);

  const [hasRun, setHasRun] = useState(false);

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
  async function fetchCardsByDeckIds(deckIds: string[]): Promise<{
    cards: CardEntry[];
    rawRows: Array<{ deckName: string; cardName: string; setCode: string; artists: string[]; status: number; deckId: string }>;
    debug: string[];
  }> {
    const currentDecks = decksRef.current;
    const deckMap = new Map(currentDecks.map((d) => [d.id, d.name]));
    const cards: CardEntry[] = [];
    const rawRows: Array<{ deckName: string; cardName: string; setCode: string; artists: string[]; status: number; deckId: string }> = [];
    const debug: string[] = [];

    debug.push(`[查询] 开始查询 ${deckIds.length} 个套牌`);

    for (const deckId of deckIds) {
      try {
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("deck_id", deckId);

        const deckName = deckMap.get(deckId) || deckId;
        if (error) {
          debug.push(`❌ 套牌 "${deckName}" 查询失败: ${error.message || JSON.stringify(error)}`);
          continue;
        }
        const count = data?.length || 0;
        debug.push(`✅ 套牌 "${deckName}" (${deckId}): ${count} 张卡`);

        if (data && data.length > 0) {
          for (const card of data) {
            const c = card as CardEntry;
            const artists = normalizeArtists(c.artist_names);
            rawRows.push({ deckName, cardName: c.card_name, setCode: c.set_code, artists, status: c.status, deckId });
            cards.push({ ...c, deck_name: deckName });
          }
        }
      } catch (err: unknown) {
        const deckName = deckMap.get(deckId) || deckId;
        const msg = err instanceof Error ? err.message : String(err);
        debug.push(`💥 套牌 "${deckName}" 查询异常: ${msg}`);
      }
    }

    debug.push(`[查询] 总计获取 ${cards.length} 张卡牌`);
    return { cards, rawRows, debug };
  }

  // ─── 事件处理 ──────────────────────────────────────────

  async function loadEvents() {
    if (eventsLoadedRef.current) return;
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (data.success) {
        setEvents(data.events);
        eventsLoadedRef.current = true;
      }
    } catch {
      eventsLoadedRef.current = false;
    } finally {
      setLoadingEvents(false);
    }
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
      setMatchError("加载画家卡牌失败，请稍后重试");
    } finally {
      setArtistCardsLoading(false);
    }
  }, []);

  async function handleParse() {
    if (!rawText.trim()) return;
    setParsing(true);
    try {
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
      }
    } catch {
      setParseMethod("");
      setMatchError("解析失败，请检查名单格式后重试");
    } finally {
      setParsing(false);
    }
  }

  useEffect(() => {
    supabase
      .from("decks")
      .select("id,name")
      .eq("user_name", getCurrentUser())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setDecks(data);
          setSelectedDecks(new Set(data.map((d) => d.id)));
        }
      });
  }, []);

  // ─── 状态切换 ──────────────────────────────────────────

  async function toggleStatus(cardId: string) {
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

    setMatched((prev) => {
      const next = new Map(prev);
      for (const [artist, cards] of next) {
        next.set(
          artist,
          cards.map((c) =>
            c.id === cardId
              ? { ...c, status: newStatus, event_name: newStatus === 3 ? currentEvent : null, event_date: newStatus === 3 ? currentEventDate : null }
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
              ? { ...e, deckCard: { ...e.deckCard, status: newStatus, event_name: newStatus === 3 ? currentEvent : null, event_date: newStatus === 3 ? currentEventDate : null } }
              : e
          )
        );
      }
      return next;
    });

    try {
      await supabase
        .from("cards")
        .update({ status: newStatus, is_signed: false, event_name: newStatus === 3 ? currentEvent : null, event_date: newStatus === 3 ? currentEventDate : null })
        .eq("id", cardId);
    } catch (err: unknown) {
      console.error("[toggleStatus] 数据库更新失败:", err);
      setMatchError("状态更新失败，请刷新页面重试");
    }
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
    const { cards, rawRows, debug } = await fetchCardsByDeckIds(deckIds);
    setRawDataPanel(rawRows);

    if (cards.length === 0) {
      setDebugInfo([...debug]);
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

    let totalCards = 0;
    for (const cards of newMatched.values()) totalCards += cards.length;
    debug.push(`[精确匹配] 结果: ${newMatched.size} 位画家匹配, ${totalCards} 张卡, ${newUnmatched.length} 位未匹配`);
    setDebugInfo([...debug]);

    setMatched(newMatched);
    setFuzzyMatched(new Map());
    setUnmatched(newUnmatched);
  }

  // ─── 模糊匹配 ──────────────────────────────────────────

  async function handleFuzzyMatch(deckIds: string[]) {
    const currentParsedArtists = parsedArtistsRef.current;

    // 1. 查询套牌卡牌
    const { cards } = await fetchCardsByDeckIds(deckIds);

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
    } catch (err: unknown) {
      console.error("[模糊匹配] API 调用异常:", err instanceof Error ? err.message : String(err));
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

  /** 匹配活动画家 */
  function matchAgainstArtists(
    parsedArtists: string[],
    expandedArtistCards: Map<string, FuzzyCardEntry[]>,
    exactMatchedKeys: Set<string>,
    artistDbKeys: string[],
    artistNormalizedMap: Map<string, string>,
    artistCards: Map<string, CardEntry[]>
  ) {
    // 构建小写 key → entries 映射
    const expandedKeyMap = new Map<string, FuzzyCardEntry[]>();
    for (const [artist, entries] of expandedArtistCards) {
      const key = artist.toLowerCase().trim();
      const existing = expandedKeyMap.get(key) || [];
      for (const e of entries) {
        if (!existing.some((x) => isSamePrinting(x, e))) {
          existing.push(e);
        }
      }
      expandedKeyMap.set(key, existing);
    }

    const newFuzzyMatched = new Map<string, FuzzyCardEntry[]>();
    const newUnmatched: string[] = [];
    const expandedDbKeys = [...expandedKeyMap.keys()];
    const expandedNormalizedMap = buildNormalizedMap(expandedDbKeys);

    for (const parsedArtist of parsedArtists) {
      const matchedKey = findMatchingArtist(parsedArtist, expandedDbKeys, expandedNormalizedMap);
      if (matchedKey) {
        newFuzzyMatched.set(parsedArtist, expandedKeyMap.get(matchedKey) || []);
      } else {
        newUnmatched.push(parsedArtist);
      }
    }

    // 兜底：确保精确匹配结果 100% 包含
    for (const parsedArtist of parsedArtists) {
      if (newFuzzyMatched.has(parsedArtist)) continue;
      const key = findMatchingArtist(parsedArtist, artistDbKeys, artistNormalizedMap);
      if (!key || !exactMatchedKeys.has(key)) continue;

      const exactCards = artistCards.get(key) || [];
      if (exactCards.length === 0) continue;

      const displayArtist = normalizeArtists(exactCards[0].artist_names)[0] || key;
      newFuzzyMatched.set(parsedArtist, exactCards.map((c) => ({
        card_name: c.card_name, set_code: c.set_code, set_name: "",
        collector_number: c.collector_number, image_url: c.image_url,
        artist: displayArtist, deckCard: c,
      })));
      const idx = newUnmatched.indexOf(parsedArtist);
      if (idx !== -1) newUnmatched.splice(idx, 1);
    }

    return { newFuzzyMatched, newUnmatched };
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

    let text = "MTG 签绘管家 — 活动准备清单\n";
    text += "=".repeat(40) + "\n\n";

    if (currentFuzzyMode && currentFuzzyMatched.size > 0) {
      for (const [artist, entries] of currentFuzzyMatched) {
        text += `🎨 ${artist} (${entries.length} 个版本)\n`;
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
        text += `🎨 ${artist} (${cards.length} 张)\n`;
        for (const card of cards) {
          text += `  - ${card.card_name} [${card.set_code.toUpperCase()}] ${card.deck_name}\n`;
        }
        text += "\n";
      }
    }

    if (currentUnmatched.length > 0) {
      text += "─".repeat(40) + "\n";
      text += "以下画家出席但你没有未签卡牌：\n";
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

  const isDev = typeof process !== "undefined" && process.env.NODE_ENV === "development";

  // ─── 渲染 ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">活动匹配</h1>
          <p className="text-muted-foreground">粘贴活动画家名单，匹配你需要签绘的卡牌</p>
        </div>
      </div>

      {/* 第一步：粘贴 + 解析 */}
      <Card>
        <CardHeader>
          <CardTitle>1. 粘贴活动画家名单</CardTitle>
          <CardDescription>直接粘贴，或从下方活动日历中一键选取</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm appearance-none whitespace-normal overflow-hidden bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23666%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-8"
            defaultValue=""
            onChange={(e) => { if (e.target.value) selectEvent(e.target.value); }}
            onFocus={() => { if (events.length === 0) loadEvents(); }}
          >
            <option value="" disabled>
              {loadingEvents ? "加载中..." : "📅 选择活动自动填充画家名单..."}
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {new Date(e.startDate).toLocaleDateString("zh-CN")} | {e.name} ({e.city}) — {e.artists.length} 位画家
              </option>
            ))}
          </select>

          <Textarea
            placeholder={`粘贴活动画家名单，例如：\nJohn Avon | Booth A12 | $20 per card\nKev Walker - Table 5\n1. Mark Tedin\n2. Terese Nielsen\n...`}
            rows={6}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleParse} disabled={parsing || !rawText.trim()}>
              <Search className="h-4 w-4 mr-2" />
              {parsing ? "解析中..." : "智能解析"}
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
                <button
                  key={a}
                  onClick={() => handleArtistClick(a)}
                  className="px-2 py-1 bg-background hover:bg-accent border rounded text-sm cursor-pointer transition-colors"
                >
                  {a}
                </button>
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
          <CardDescription>勾选要比对的套牌，然后点击开始匹配</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {decks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => toggleDeck(deck.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  selectedDecks.has(deck.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-accent"
                }`}
              >
                {selectedDecks.has(deck.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {deck.name}
              </button>
            ))}
            {decks.length === 0 && <p className="text-sm text-muted-foreground">暂无套牌，请先导入套牌</p>}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleMatch} disabled={matching || parsedArtists.length === 0 || selectedDecks.size === 0}>
              {matching ? "匹配中..." : "开始匹配"}
            </Button>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={fuzzyMode}
                onChange={(e) => setFuzzyMode(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 accent-primary cursor-pointer"
              />
              <span className="text-sm flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                模糊匹配
              </span>
            </label>
          </div>
          {fuzzyMode && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              <Sparkles className="h-3 w-3 inline mr-1" />
              模糊匹配会搜索套牌中每张卡牌的<strong>所有印刷版本</strong>，扩大匹配范围。
              例如：你的套牌中有一张异画版「脑力激荡」，开启后将匹配<strong>所有画过脑力激荡</strong>的画家，而非仅限当前版本的画家。
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
          toggleStatus={toggleStatus}
          exportText={exportText}
        />
      )}

      {/* 调试面板 — 仅开发环境 */}
      {isDev && hasRun && debugInfo.length > 0 && (
        <Card className="border-dashed border-amber-300 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-amber-600">🐛</span> 调试信息
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-amber-900 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
              {debugInfo.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* 原始数据面板 — 仅开发环境 */}
      {isDev && hasRun && rawDataPanel.length > 0 && (
        <Card className="border-dashed border-blue-300 bg-blue-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-blue-600">📊</span> 数据库原始返回 (共 {rawDataPanel.length} 张卡)
              <span className="text-xs font-normal text-blue-500 ml-2">— 按套牌分组</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const byDeck = new Map<string, typeof rawDataPanel>();
              for (const row of rawDataPanel) {
                const arr = byDeck.get(row.deckName) || [];
                arr.push(row);
                byDeck.set(row.deckName, arr);
              }
              return Array.from(byDeck).map(([deckName, rows]) => (
                <div key={deckName} className="mb-4 last:mb-0">
                  <p className="text-sm font-semibold text-blue-800 mb-2">📦 {deckName} ({rows.length} 张)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-blue-100">
                          <th className="p-1.5 text-left border border-blue-200">卡牌名</th>
                          <th className="p-1.5 text-left border border-blue-200">系列</th>
                          <th className="p-1.5 text-left border border-blue-200">画家</th>
                          <th className="p-1.5 text-center border border-blue-200 w-12">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={`${row.deckName}-${row.cardName}-${row.setCode}-${i}`}>
                            <td className="p-1.5 border border-blue-100">{row.cardName}</td>
                            <td className="p-1.5 border border-blue-100">{row.setCode}</td>
                            <td className="p-1.5 border border-blue-100">{row.artists.join(", ")}</td>
                            <td className="p-1.5 text-center border border-blue-100">{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ));
            })()}
          </CardContent>
        </Card>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[65vh] overflow-y-auto pr-2">
                {artistCards.map((card) => (
                  <div
                    key={`${card.set}-${card.collector_number}`}
                    className="rounded-lg border overflow-hidden bg-background"
                    title={`${card.set_name} #${card.collector_number}`}
                  >
                    {card.image_url ? (
                      <img src={card.image_url} alt={card.name} className="w-full" loading="lazy" />
                    ) : (
                      <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        {card.name}
                      </div>
                    )}
                    <div className="p-1.5 text-[10px]">
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
  toggleStatus: (cardId: string) => void;
  exportText: () => void;
}

function MatchResultCard({
  fuzzyMode, matching, matched, fuzzyMatched, unmatched, parsedArtists, toggleStatus, exportText,
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
                  <Sparkles className="h-4 w-4 inline mr-1" />模糊
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
            <Button variant="outline" size="sm" onClick={exportText}>
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
          <p className="text-muted-foreground text-center py-8">没有匹配到任何画家，请确认活动名单和套牌选择是否正确</p>
        ) : fuzzyMode ? (
          <FuzzyMatchResults fuzzyMatched={fuzzyMatched} toggleStatus={toggleStatus} />
        ) : (
          <ExactMatchResults matched={matched} toggleStatus={toggleStatus} />
        )}

        {!matching && unmatched.length > 0 && (
          <div className="pt-4 border-t mt-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">以下画家出席但你没有未签卡牌：</h4>
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

function ExactMatchResults({ matched, toggleStatus }: { matched: Map<string, CardEntry[]>; toggleStatus: (cardId: string) => void }) {
  return (
    <div className="space-y-6">
      {Array.from(matched).map(([artist, cards]) => (
        <div key={artist}>
          <h3 className="text-base font-semibold mb-3">
            🎨 {artist} ← 出席！<span className="ml-2 text-sm font-normal text-muted-foreground">({cards.length} 张)</span>
          </h3>
          {(() => {
            const byDeck = new Map<string, CardEntry[]>();
            for (const c of cards) {
              const d = c.deck_name || "未知套牌";
              const arr = byDeck.get(d) || [];
              arr.push(c);
              byDeck.set(d, arr);
            }
            return Array.from(byDeck).map(([deckName, deckCards]) => (
              <div key={deckName} className="mb-3">
                <p className="text-xs text-muted-foreground mb-2">📦 {deckName}</p>
                <div className="flex flex-wrap gap-3">
                  {deckCards.map((card) => (
                    <CardThumbnail
                      key={card.id}
                      cardId={card.id}
                      imageUrl={card.image_url}
                      cardName={card.card_name}
                      status={card.status}
                      toggleStatus={toggleStatus}
                    />
                  ))}
                </div>
              </div>
            ));
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
            <h3 className="text-base font-semibold mb-3">
              🎨 {artist} ← 出席！
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({entries.length} 个版本{deckCount > 0 && `，${deckCount} 张在套牌中`})
              </span>
            </h3>

            {Array.from(byCardName).map(([cardName, versions]) => (
              <div key={cardName} className="mb-3">
                <p className="text-xs text-muted-foreground mb-2">📦 {cardName}</p>
                <div className="flex flex-wrap gap-3">
                  {versions.map((v, idx) => {
                    const isInDeck = !!v.deckCard;
                    const cardId = v.deckCard?.id;
                    const status = v.deckCard?.status ?? 0;

                    return (
                      <div
                        key={`${v.set_code}-${v.collector_number}-${idx}`}
                        onClick={() => { if (cardId) toggleStatus(cardId); }}
                        className={`relative w-24 rounded-lg overflow-hidden border transition-all hover:scale-105 ${
                          isInDeck ? "cursor-pointer hover:shadow-md" : "cursor-default opacity-60"
                        } ${statusBorderClass(isInDeck, status)}`}
                        title={isInDeck ? { 0: "待签", 1: "送签中", 2: "已签", 3: "心动" }[status] : "非套牌版本"}
                      >
                        <div className={isInDeck && status >= 1 ? "opacity-75" : ""}>
                          {v.image_url ? (
                            <img src={v.image_url} alt={v.card_name} className="w-full" loading="lazy" />
                          ) : (
                            <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                              {v.card_name}
                            </div>
                          )}
                        </div>
                        <StatusBadge status={status} isInDeck={isInDeck} />
                        {!isInDeck && (
                          <div className="absolute top-0 right-0 bg-amber-500 text-white text-[9px] px-1 rounded-bl">其他</div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center truncate">
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
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${
        status === 3 ? "bg-pink-500" : status === 1 ? "bg-blue-500" : status === 2 ? "bg-green-600" : "bg-green-500"
      }`}>
        {status === 3 ? "♥" : status === 1 ? "…" : status === 2 ? "✓" : "✓"}
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
  cardId, imageUrl, cardName, status, toggleStatus,
}: {
  cardId: string;
  imageUrl: string | null;
  cardName: string;
  status: number;
  toggleStatus: (cardId: string) => void;
}) {
  return (
    <div
      onClick={() => toggleStatus(cardId)}
      className={`relative w-24 rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 ${
        status >= 1
          ? status === 3 ? "border-pink-400" : status === 1 ? "border-blue-400" : "border-green-500"
          : "border-border hover:shadow-md"
      }`}
      title={{ 0: "待签", 1: "送签中", 2: "已签", 3: "心动" }[status ?? 0]}
    >
      <div className={status >= 1 ? "opacity-75" : ""}>
        {imageUrl ? (
          <img src={imageUrl} alt={cardName} className="w-full" loading="lazy" />
        ) : (
          <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {cardName}
          </div>
        )}
      </div>
      <StatusBadge status={status} isInDeck={true} />
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center truncate">
        {cardName}
      </div>
    </div>
  );
}