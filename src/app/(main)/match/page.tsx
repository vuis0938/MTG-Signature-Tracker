"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

interface Deck {
  id: string;
  name: string;
}

interface CardEntry {
  id: string;
  deck_id: string;
  deck_name: string;
  card_name: string;
  set_code: string;
  collector_number: string;
  artist_names: string[];
  image_url: string | null;
  status: number;
}

/** 模糊匹配结果中的卡牌 — 来自 Scryfall 的印刷版本 */
interface FuzzyCardEntry {
  card_name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  artist: string;
  /** 如果该版本正好在用户套牌中，指向套牌中的卡牌 */
  deckCard?: CardEntry;
}

interface ArtistCard {
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
  released_at: string;
}

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
  interface CalendarEvent {
    id: string;
    name: string;
    city: string;
    startDate: string;
    artists: string[];
  }
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // 匹配
  const [matching, setMatching] = useState(false);
  const [fuzzyMode, setFuzzyMode] = useState(false);
  const [matched, setMatched] = useState<Map<string, CardEntry[]>>(new Map());
  const [fuzzyMatched, setFuzzyMatched] = useState<Map<string, FuzzyCardEntry[]>>(new Map());
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [currentEvent, setCurrentEvent] = useState(""); // 当前选中的活动名
  const [currentEventDate, setCurrentEventDate] = useState(""); // 当前选中的活动日期

  // 画家卡牌弹窗
  const [artistDialog, setArtistDialog] = useState<string | null>(null);
  const [artistCards, setArtistCards] = useState<ArtistCard[]>([]);
  const [artistCardsLoading, setArtistCardsLoading] = useState(false);

  // 加载活动列表
  async function loadEvents() {
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (data.success) setEvents(data.events);
    } catch {}
    setLoadingEvents(false);
  }

  // 选择活动 → 直接填充画家列表（无需 LLM 解析）
  function selectEvent(eventId: string) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    setRawText(event.artists.join("\n"));
    setParsedArtists(event.artists);
    setParseMethod("活动日历");
    setCurrentEvent(event.name);
    setCurrentEventDate(
      new Date(event.startDate).toLocaleDateString("zh-CN")
    );
    setMatched(new Map());
    setFuzzyMatched(new Map());
    setUnmatched([]);
    setHasRun(false);
  }

  // 点击画家名 → 加载其所有卡牌版本
  async function handleArtistClick(artist: string) {
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
    } finally {
      setArtistCardsLoading(false);
    }
  }

  // 解析名单（粘贴文本时用 LLM/正则）
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
        setMatched(new Map());
        setFuzzyMatched(new Map());
        setUnmatched([]);
        setHasRun(false);
      }
    } catch {} finally {
      setParsing(false);
    }
  }

  const [hasRun, setHasRun] = useState(false);
  const matchingRef = useRef(false); // 防止并发匹配

  // 🔒 用 ref 锁定最新状态，避免闭包陷阱
  const selectedDecksRef = useRef(selectedDecks);
  selectedDecksRef.current = selectedDecks;
  const parsedArtistsRef = useRef(parsedArtists);
  parsedArtistsRef.current = parsedArtists;
  const decksRef = useRef(decks);
  decksRef.current = decks;

  // 🐛 调试面板
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  // 📊 原始数据面板 — 存储每张卡的关键信息用于对比
  const [rawDataPanel, setRawDataPanel] = useState<Array<{
    deckName: string;
    cardName: string;
    setCode: string;
    artists: string[];
    status: number;
    deckId: string;
  }>>([]);

  useEffect(() => {
    supabase
      .from("decks")
      .select("id,name")
      .eq("user_name", getCurrentUser())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setDecks(data);
          setSelectedDecks(new Set(data.map((d) => d.id))); // 默认全选
        }
      });
  }, []);

  // 三态切换（匹配页专属：0待签 → 3心动 → 1送签中 → 0待签）
  async function toggleStatus(cardId: string) {
    let currentStatus = 0;
    for (const cards of matched.values()) {
      const found = cards.find((c) => c.id === cardId);
      if (found) { currentStatus = found.status; break; }
    }

    // 匹配页循环: 0→3, 3→1, 1→0
    const cycle: Record<number, number> = { 0: 3, 3: 1, 1: 0 };
    const newStatus = cycle[currentStatus] ?? 0;

    setMatched((prev) => {
      const next = new Map(prev);
      for (const [artist, cards] of next) {
        next.set(
          artist,
          cards.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  status: newStatus,
                  event_name: newStatus === 3 ? currentEvent : null,
                  event_date: newStatus === 3 ? currentEventDate : null,
                }
              : c
          )
        );
      }
      return next;
    });

    await supabase
      .from("cards")
      .update({
        status: newStatus,
        is_signed: false,
        event_name: newStatus === 3 ? currentEvent : null,
        event_date: newStatus === 3 ? currentEventDate : null,
      })
      .eq("id", cardId);
  }

  // 执行匹配
  async function handleMatch() {
    const currentSelectedDecks = selectedDecksRef.current;
    const currentParsedArtists = parsedArtistsRef.current;

    if (currentParsedArtists.length === 0 || currentSelectedDecks.size === 0) return;
    if (matchingRef.current) return; // 防止并发
    matchingRef.current = true;

    setMatching(true);
    setHasRun(true);

    const deckIds = Array.from(currentSelectedDecks);
    const debug: string[] = [];
    debug.push(`[匹配] 套牌数: ${deckIds.length}, 画家数: ${currentParsedArtists.length}`);
    debug.push(`[匹配] deckIds: ${JSON.stringify(deckIds)}`);
    setDebugInfo(debug);

    if (fuzzyMode) {
      await handleFuzzyMatch(deckIds);
    } else {
      await handleExactMatch(deckIds);
    }

    setMatching(false);
    matchingRef.current = false;
  }

  // 精确匹配（核心逻辑 — 顺序查询 + 错误处理 + 调试）
  async function handleExactMatch(deckIds: string[]) {
    const currentDecks = decksRef.current;
    const currentParsedArtists = parsedArtistsRef.current;
    const deckMap = new Map(currentDecks.map((d) => [d.id, d.name]));

    const debug: string[] = [];
    const rawRows: Array<{ deckName: string; cardName: string; setCode: string; artists: string[]; status: number; deckId: string }> = [];

    debug.push(`🔖 代码版本: v4 (ref+顺序+rawPanel) — ${new Date().toISOString()}`);
    debug.push(`[精确匹配] 开始查询 ${deckIds.length} 个套牌`);
    console.log("[精确匹配] 开始查询", deckIds);

    // ✅ 顺序查询
    const allCards: CardEntry[] = [];
    for (const deckId of deckIds) {
      try {
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("deck_id", deckId);

        const deckName = deckMap.get(deckId) || deckId;
        if (error) {
          debug.push(`❌ 套牌 "${deckName}" 查询失败: ${error.message || JSON.stringify(error)}`);
          console.error(`[精确匹配] 套牌 "${deckName}" 查询失败:`, error);
          continue;
        }
        const count = data?.length || 0;
        debug.push(`✅ 套牌 "${deckName}" (${deckId}): ${count} 张卡`);

        // 🔍 console.table 原始数据
        const deckRows: Array<Record<string, unknown>> = [];
        if (data && data.length > 0) {
          for (const card of data) {
            const c = card as CardEntry;
            const artists = normalizeArtists(c.artist_names);
            debug.push(`  📋 ${c.card_name} [${c.set_code}] artists=${JSON.stringify(artists)} status=${c.status}`);
            rawRows.push({ deckName, cardName: c.card_name, setCode: c.set_code, artists, status: c.status, deckId });
            deckRows.push({ 卡牌名: c.card_name, 系列: c.set_code, 画家: artists.join(", "), 状态: c.status });
          }
          allCards.push(...(data as CardEntry[]));
        }
        console.log(`\n=== 套牌: ${deckName} (${count} 张) ===`);
        console.table(deckRows);
      } catch (err: any) {
        const deckName = deckMap.get(deckId) || deckId;
        debug.push(`💥 套牌 "${deckName}" 查询异常: ${err?.message || String(err)}`);
        console.error(`[精确匹配] 套牌 "${deckName}" 查询异常:`, err);
      }
    }

    debug.push(`[精确匹配] 总计获取 ${allCards.length} 张卡牌`);
    setRawDataPanel(rawRows);
    setDebugInfo([...debug]);

    if (allCards.length === 0) {
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([...currentParsedArtists]);
      return;
    }

    // 构建 key→cards 映射（key = 小写 trim 后的画家名）
    const artistToCards = new Map<string, CardEntry[]>();

    for (const card of allCards) {
      card.deck_name = deckMap.get(card.deck_id) || "";
      const artists = normalizeArtists(card.artist_names);
      for (const artist of artists) {
        const key = artist.toLowerCase().trim();
        const list = artistToCards.get(key) || [];
        list.push(card);
        artistToCards.set(key, list);
      }
    }

    debug.push(`[精确匹配] artistToCards 共 ${artistToCards.size} 个画家key`);
    debug.push(`[精确匹配] 画家keys: ${JSON.stringify([...artistToCards.keys()])}`);

    const newMatched = new Map<string, CardEntry[]>();
    const newUnmatched: string[] = [];

    for (const parsedArtist of currentParsedArtists) {
      const key = parsedArtist.toLowerCase().trim();
      const matchedCards = artistToCards.get(key);

      if (matchedCards && matchedCards.length > 0) {
        newMatched.set(parsedArtist, matchedCards);
      } else {
        newUnmatched.push(parsedArtist);
      }
    }

    // 计算总卡牌数
    let totalCards = 0;
    for (const cards of newMatched.values()) totalCards += cards.length;

    debug.push(`[精确匹配] 结果: ${newMatched.size} 位画家匹配, ${totalCards} 张卡, ${newUnmatched.length} 位未匹配`);
    debug.push(`[精确匹配] 匹配画家: ${JSON.stringify([...newMatched.keys()])}`);
    debug.push(`[精确匹配] 未匹配画家: ${JSON.stringify(newUnmatched)}`);

    // 🔍 console.table 最终结果
    const resultRows: Array<Record<string, unknown>> = [];
    for (const [artist, cards] of newMatched) {
      for (const c of cards) {
        resultRows.push({ 画家: artist, 卡牌: c.card_name, 系列: c.set_code, 套牌: c.deck_name, 状态: c.status });
      }
    }
    console.log(`\n=== 最终匹配结果 (${newMatched.size} 位画家, ${totalCards} 张卡) ===`);
    console.table(resultRows);

    // 🔍 专门检查 "Harbinger"
    const harbingerCards = allCards.filter((c) => c.card_name.toLowerCase().includes("harbinger"));
    if (harbingerCards.length > 0) {
      debug.push(`🔍 找到 ${harbingerCards.length} 张含 "Harbinger" 的卡:`);
      for (const hc of harbingerCards) {
        debug.push(`  → ${hc.card_name} [${hc.set_code}] deck=${hc.deck_name} artists=${JSON.stringify(normalizeArtists(hc.artist_names))}`);
      }
      // 检查这些卡是否出现在最终结果中
      const harbingerInResult = resultRows.filter((r) => String(r.卡牌).toLowerCase().includes("harbinger"));
      debug.push(`🔍 其中 ${harbingerInResult.length} 张出现在最终匹配结果中`);
    } else {
      debug.push(`🔍 未找到含 "Harbinger" 的卡牌`);
    }

    setDebugInfo([...debug]);

    setMatched(newMatched);
    setFuzzyMatched(new Map());
    setUnmatched(newUnmatched);
  }

  /** 安全解析 artist_names：兼容 string[] 和 Supabase 可能返回的 string */
  function normalizeArtists(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return [raw];
    }
    return [];
  }

  // 模糊匹配：查询 Scryfall 获取所有卡牌的全部印刷版本，扩展画家列表
  async function handleFuzzyMatch(deckIds: string[]) {
    const currentDecks = decksRef.current;
    const currentParsedArtists = parsedArtistsRef.current;
    const deckMap = new Map(currentDecks.map((d) => [d.id, d.name]));

    // 1. 顺序查询每个套牌，获取所有卡牌
    const cards: CardEntry[] = [];
    for (const deckId of deckIds) {
      try {
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("deck_id", deckId);
        if (error) {
          console.error(`[模糊匹配] 套牌 ${deckId} 查询失败:`, error);
          continue;
        }
        if (data) {
          for (const card of data) {
            (card as CardEntry).deck_name = deckMap.get((card as CardEntry).deck_id) || "";
          }
          cards.push(...(data as CardEntry[]));
        }
      } catch (err) {
        console.error(`[模糊匹配] 套牌 ${deckId} 查询异常:`, err);
      }
    }

    if (cards.length === 0) {
      setMatched(new Map());
      setFuzzyMatched(new Map());
      setUnmatched([]);
      return;
    }

    // 2. 先跑精确匹配，作为基线（保证模糊 ≥ 精确）— 纯精确，不用 Fuse
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

    // 精确匹配命中的画家 key 集合（纯 case-insensitive 精确匹配）
    const exactMatchedKeys = new Set<string>();
    for (const artist of currentParsedArtists) {
      const key = artist.toLowerCase().trim();
      if (artistCards.has(key)) {
        exactMatchedKeys.add(key);
      }
    }

    // 3. 调用模糊匹配 API 获取所有印刷版本
    const fuzzyRes = await fetch("/api/fuzzy-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckIds }),
    });
    const fuzzyData = await fuzzyRes.json();

    // 4. 构建扩展的 画家 → 卡牌 映射（包含所有印刷版本）
    const expandedArtistCards = new Map<string, FuzzyCardEntry[]>();

    if (fuzzyData.success && fuzzyData.cardMap) {
      const cardMap: Record<string, {
        card_name: string;
        printings: Array<{
          artist: string;
          set: string;
          set_name: string;
          collector_number: string;
          image_url: string | null;
          released_at: string;
        }>;
        allArtists: string[];
      }> = fuzzyData.cardMap;

      for (const [cardName, info] of Object.entries(cardMap)) {
        const deckCard = cards.find((c) => c.card_name === cardName);

        for (const printing of info.printings) {
          const artist = printing.artist;
          const existing = expandedArtistCards.get(artist) || [];

          const alreadyExists = existing.some(
            (e) =>
              e.card_name === cardName &&
              e.set_code === printing.set &&
              e.collector_number === printing.collector_number
          );
          if (alreadyExists) continue;

          existing.push({
            card_name: cardName,
            set_code: printing.set,
            set_name: printing.set_name,
            collector_number: printing.collector_number,
            image_url: printing.image_url,
            artist,
            deckCard: deckCard
              ? { ...deckCard, artist_names: [artist] }
              : undefined,
          });
          expandedArtistCards.set(artist, existing);
        }
      }
    }

    // 5. 把精确匹配的结果全部并入 expandedArtistCards（兜底 + 补缺）
    for (const key of exactMatchedKeys) {
      const exactCards = artistCards.get(key) || [];
      if (exactCards.length === 0) continue;
      // 用第一张卡牌的原始画家名作为显示名
      const displayArtist = normalizeArtists(exactCards[0].artist_names)[0] || key;

      if (!expandedArtistCards.has(displayArtist)) {
        const entries: FuzzyCardEntry[] = exactCards.map((c) => ({
          card_name: c.card_name,
          set_code: c.set_code,
          set_name: "",
          collector_number: c.collector_number,
          image_url: c.image_url,
          artist: displayArtist,
          deckCard: c,
        }));
        expandedArtistCards.set(displayArtist, entries);
      } else {
        const existing = expandedArtistCards.get(displayArtist)!;
        for (const c of exactCards) {
          const alreadyExists = existing.some(
            (e) =>
              e.card_name === c.card_name &&
              e.set_code === c.set_code &&
              e.collector_number === c.collector_number
          );
          if (!alreadyExists) {
            existing.push({
              card_name: c.card_name,
              set_code: c.set_code,
              set_name: "",
              collector_number: c.collector_number,
              image_url: c.image_url,
              artist: displayArtist,
              deckCard: c,
            });
          }
        }
      }
    }

    // 6. 匹配活动画家（纯精确匹配，不用 Fuse 近似）
    // 构建 expandedArtistCards 的 key→entries 映射
    const expandedKeyMap = new Map<string, FuzzyCardEntry[]>();
    for (const [artist, entries] of expandedArtistCards) {
      const key = artist.toLowerCase().trim();
      const existing = expandedKeyMap.get(key) || [];
      for (const e of entries) {
        if (!existing.some((x) => x.card_name === e.card_name && x.set_code === e.set_code && x.collector_number === e.collector_number)) {
          existing.push(e);
        }
      }
      expandedKeyMap.set(key, existing);
    }

    const newFuzzyMatched = new Map<string, FuzzyCardEntry[]>();
    const newUnmatched: string[] = [];

    for (const parsedArtist of currentParsedArtists) {
      const key = parsedArtist.toLowerCase().trim();
      const entries = expandedKeyMap.get(key);

      if (entries && entries.length > 0) {
        newFuzzyMatched.set(parsedArtist, entries);
      } else {
        newUnmatched.push(parsedArtist);
      }
    }

    // 7. 兜底：确保精确匹配结果 100% 包含在模糊匹配中
    for (const key of exactMatchedKeys) {
      const exactCards = artistCards.get(key) || [];
      if (exactCards.length === 0) continue;

      // 找到所有映射到这个 key 的 parsedArtist
      for (const parsedArtist of currentParsedArtists) {
        if (parsedArtist.toLowerCase().trim() !== key) continue;
        if (newFuzzyMatched.has(parsedArtist)) continue;

        const displayArtist = normalizeArtists(exactCards[0].artist_names)[0] || key;
        const entries: FuzzyCardEntry[] = exactCards.map((c) => ({
          card_name: c.card_name,
          set_code: c.set_code,
          set_name: "",
          collector_number: c.collector_number,
          image_url: c.image_url,
          artist: displayArtist,
          deckCard: c,
        }));
        newFuzzyMatched.set(parsedArtist, entries);
        const idx = newUnmatched.indexOf(parsedArtist);
        if (idx !== -1) newUnmatched.splice(idx, 1);
      }
    }

    setMatched(new Map());
    setFuzzyMatched(newFuzzyMatched);
    setUnmatched(newUnmatched);
  }

  // 切换套牌选择
  function toggleDeck(id: string) {
    setSelectedDecks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 导出文本清单
  function exportText() {
    let text = "MTG 签绘管家 — 活动准备清单\n";
    text += "=".repeat(40) + "\n\n";

    if (fuzzyMode && fuzzyMatched.size > 0) {
      for (const [artist, entries] of fuzzyMatched) {
        text += `🎨 ${artist} (${entries.length} 个版本)\n`;
        // 按卡牌名分组
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
      for (const [artist, cards] of matched) {
        text += `🎨 ${artist} (${cards.length} 张)\n`;
        for (const card of cards) {
          text += `  - ${card.card_name} [${card.set_code.toUpperCase()}] ${card.deck_name}\n`;
        }
        text += "\n";
      }
    }

    if (unmatched.length > 0) {
      text += "─".repeat(40) + "\n";
      text += "以下画家出席但你没有未签卡牌：\n";
      unmatched.forEach((a) => (text += `  - ${a}\n`));
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mtg-signing-list.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">活动匹配</h1>
          <p className="text-muted-foreground">
            粘贴活动画家名单，匹配你需要签绘的卡牌
          </p>
        </div>
      </div>

      {/* 第一步：粘贴 + 解析 */}
      <Card>
        <CardHeader>
          <CardTitle>1. 粘贴活动画家名单</CardTitle>
          <CardDescription>
            直接粘贴，或从下方活动日历中一键选取
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 活动选择器 */}
            <select
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm appearance-none whitespace-normal overflow-hidden bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23666%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-8"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) selectEvent(e.target.value);
              }}
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
            placeholder={`粘贴活动画家名单，例如：
John Avon | Booth A12 | $20 per card
Kev Walker - Table 5
1. Mark Tedin
2. Terese Nielsen
...`}
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

          {/* 解析结果预览 */}
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
        </CardContent>
      </Card>

      {/* 第二步：选择套牌 + 匹配 */}
      <Card>
        <CardHeader>
          <CardTitle>2. 选择套牌并匹配</CardTitle>
          <CardDescription>勾选要比对的套牌，然后点击开始匹配</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 套牌多选 */}
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
                {selectedDecks.has(deck.id) ? (
                  <CheckSquare className="h-4 w-4" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                {deck.name}
              </button>
            ))}
            {decks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                暂无套牌，请先导入套牌
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleMatch}
              disabled={
                matching || parsedArtists.length === 0 || selectedDecks.size === 0
              }
            >
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

      {/* 🐛 调试面板 — 仅在匹配后有数据时显示 */}
      {hasRun && debugInfo.length > 0 && (
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

      {/* 📊 原始数据对比面板 */}
      {hasRun && rawDataPanel.length > 0 && (
        <Card className="border-dashed border-blue-300 bg-blue-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-blue-600">📊</span> 数据库原始返回 (共 {rawDataPanel.length} 张卡)
              <span className="text-xs font-normal text-blue-500 ml-2">
                — 按套牌分组
              </span>
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
                  <p className="text-sm font-semibold text-blue-800 mb-2">
                    📦 {deckName} ({rows.length} 张)
                  </p>
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
                          <tr key={i} className={row.cardName.toLowerCase().includes("harbinger") ? "bg-yellow-100 font-bold" : ""}>
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

      {/* ─── 画家卡牌画廊弹窗 ─── */}
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
              <p className="text-sm text-muted-foreground text-center py-8">
                未找到该画家的卡牌
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[65vh] overflow-y-auto pr-2">
                {artistCards.map((card) => (
                  <div
                    key={`${card.set}-${card.collector_number}`}
                    className="rounded-lg border overflow-hidden bg-background"
                    title={`${card.set_name} #${card.collector_number}`}
                  >
                    {card.image_url ? (
                      <img
                        src={card.image_url}
                        alt={card.name}
                        className="w-full"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        {card.name}
                      </div>
                    )}
                    <div className="p-1.5 text-[10px]">
                      <p className="font-medium truncate">{card.name}</p>
                      <p className="text-muted-foreground truncate">
                        {card.set_name} #{card.collector_number}
                      </p>
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

// ─── 匹配结果卡片（精确 / 模糊共用） ──────────────────────────

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
  fuzzyMode,
  matching,
  matched,
  fuzzyMatched,
  unmatched,
  parsedArtists,
  toggleStatus,
  exportText,
}: MatchResultCardProps) {
  const activeMatched = fuzzyMode ? fuzzyMatched : matched;
  const matchedCount = activeMatched.size;

  // 计算卡牌总数
  let totalCards = 0;
  if (fuzzyMode) {
    for (const entries of fuzzyMatched.values()) {
      totalCards += entries.length;
    }
  } else {
    for (const cards of matched.values()) {
      totalCards += cards.length;
    }
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
                  <Sparkles className="h-4 w-4 inline mr-1" />
                  模糊
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {matching ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在匹配中...
                </span>
              ) : (
                <>
                  匹配 {matchedCount}/{parsedArtists.length} 位画家
                  {matchedCount > 0 && ` · 共 ${totalCards} 个版本`}
                </>
              )}
            </CardDescription>
          </div>
          {!matching && matchedCount > 0 && (
            <Button variant="outline" size="sm" onClick={exportText}>
              <Download className="h-4 w-4 mr-2" />
              导出清单
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
          <p className="text-muted-foreground text-center py-8">
            没有匹配到任何画家，请确认活动名单和套牌选择是否正确
          </p>
        ) : fuzzyMode ? (
          <FuzzyMatchResults fuzzyMatched={fuzzyMatched} toggleStatus={toggleStatus} />
        ) : (
          <ExactMatchResults matched={matched} toggleStatus={toggleStatus} />
        )}

        {/* 未匹配的画家 */}
        {!matching && unmatched.length > 0 && (
          <div className="pt-4 border-t mt-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">
              以下画家出席但你没有未签卡牌：
            </h4>
            <div className="flex flex-wrap gap-2">
              {unmatched.map((a) => (
                <span
                  key={a}
                  className="px-2 py-1 bg-accent text-muted-foreground rounded text-sm line-through"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 精确匹配结果 ──────────────────────────────────────────

function ExactMatchResults({
  matched,
  toggleStatus,
}: {
  matched: Map<string, CardEntry[]>;
  toggleStatus: (cardId: string) => void;
}) {
  return (
    <div className="space-y-6">
      {Array.from(matched).map(([artist, cards]) => (
        <div key={artist}>
          <h3 className="text-base font-semibold mb-3">
            🎨 {artist} ← 出席！
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({cards.length} 张)
            </span>
          </h3>
          {/* 按套牌分组 */}
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
                <p className="text-xs text-muted-foreground mb-2">
                  📦 {deckName}
                </p>
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

function FuzzyMatchResults({
  fuzzyMatched,
  toggleStatus,
}: {
  fuzzyMatched: Map<string, FuzzyCardEntry[]>;
  toggleStatus: (cardId: string) => void;
}) {
  return (
    <div className="space-y-6">
      {Array.from(fuzzyMatched).map(([artist, entries]) => {
        // 按卡牌名分组
        const byCardName = new Map<string, FuzzyCardEntry[]>();
        for (const e of entries) {
          const arr = byCardName.get(e.card_name) || [];
          arr.push(e);
          byCardName.set(e.card_name, arr);
        }

        // 统计套牌中的版本数
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
                <p className="text-xs text-muted-foreground mb-2">
                  📦 {cardName}
                </p>
                <div className="flex flex-wrap gap-3">
                  {versions.map((v, idx) => {
                    const isInDeck = !!v.deckCard;
                    const cardId = v.deckCard?.id;
                    const status = v.deckCard?.status ?? 0;

                    return (
                      <div
                        key={`${v.set_code}-${v.collector_number}-${idx}`}
                        onClick={() => {
                          if (cardId) toggleStatus(cardId);
                        }}
                        className={`relative w-24 rounded-lg overflow-hidden border transition-all hover:scale-105 ${
                          isInDeck
                            ? "cursor-pointer hover:shadow-md"
                            : "cursor-default opacity-60"
                        } ${
                          isInDeck && status >= 1
                            ? status === 3
                              ? "border-pink-400 ring-1 ring-pink-400"
                              : status === 1
                                ? "border-blue-400 ring-1 ring-blue-400"
                                : "border-green-500 ring-1 ring-green-500"
                            : isInDeck
                              ? "border-border"
                              : "border-border border-dashed"
                        }`}
                        title={
                          isInDeck
                            ? { 0: "待签", 1: "送签中", 3: "心动" }[status]
                            : "非套牌版本"
                        }
                      >
                        <div className={isInDeck && status >= 1 ? "opacity-75" : ""}>
                          {v.image_url ? (
                            <img
                              src={v.image_url}
                              alt={v.card_name}
                              className="w-full"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                              {v.card_name}
                            </div>
                          )}
                        </div>

                        {/* 状态标记 — 仅套牌中的卡牌 */}
                        {isInDeck && status >= 1 && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${
                                status === 3
                                  ? "bg-pink-500"
                                  : status === 1
                                    ? "bg-blue-500"
                                    : "bg-green-500"
                              }`}
                            >
                              {status === 3 ? "♥" : status === 1 ? "…" : "✓"}
                            </div>
                          </div>
                        )}

                        {/* 非套牌版本标记 */}
                        {!isInDeck && (
                          <div className="absolute top-0 right-0 bg-amber-500 text-white text-[9px] px-1 rounded-bl">
                            其他
                          </div>
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

// ─── 卡牌缩略图（精确匹配用） ──────────────────────────────

function CardThumbnail({
  cardId,
  imageUrl,
  cardName,
  status,
  toggleStatus,
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
          ? status === 3
            ? "border-pink-400"
            : status === 1
              ? "border-blue-400"
              : "border-green-500"
          : "border-border hover:shadow-md"
      }`}
      title={{ 0: "待签", 1: "送签中", 3: "心动" }[status ?? 0]}
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
      {status >= 1 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${
              status === 3 ? "bg-pink-500" : status === 1 ? "bg-blue-500" : "bg-green-500"
            }`}
          >
            {status === 3 ? "♥" : status === 1 ? "…" : "✓"}
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center truncate">
        {cardName}
      </div>
    </div>
  );
}
