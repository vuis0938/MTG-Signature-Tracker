"use client";

import { useState, useEffect } from "react";
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
import Fuse from "fuse.js";
import { Search, Download, CheckSquare, Square, Loader2 } from "lucide-react";

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
  const [matched, setMatched] = useState<Map<string, CardEntry[]>>(new Map());
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [currentEvent, setCurrentEvent] = useState(""); // 当前选中的活动名
  const [currentEventDate, setCurrentEventDate] = useState(""); // 当前选中的活动日期

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
    setUnmatched([]);
    setHasRun(false);
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
        setUnmatched([]);
        setHasRun(false);
      }
    } catch {} finally {
      setParsing(false);
    }
  }

  const [hasRun, setHasRun] = useState(false);

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
    if (parsedArtists.length === 0 || selectedDecks.size === 0) return;

    setMatching(true);
    setHasRun(true);

    // 查询选中套牌的所有卡牌
    const deckIds = Array.from(selectedDecks);
    const { data: cards } = await supabase
      .from("cards")
      .select("*")
      .in("deck_id", deckIds)
      .order("artist_names");

    // 构建画家 → 卡牌索引
    const artistCards = new Map<string, CardEntry[]>();
    if (cards) {
      // 附加 deck_name
      const deckMap = new Map(decks.map((d) => [d.id, d.name]));
      for (const card of cards) {
        card.deck_name = deckMap.get(card.deck_id) || "";
        for (const artist of card.artist_names) {
          const existing = artistCards.get(artist) || [];
          existing.push(card);
          artistCards.set(artist, existing);
        }
      }
    }

    // Fuse.js 模糊匹配
    const dbArtists = Array.from(artistCards.keys());
    const fuse = new Fuse(dbArtists, {
      threshold: 0.4,
      distance: 100,
      includeScore: true,
    });

    const newMatched = new Map<string, CardEntry[]>();
    const newUnmatched: string[] = [];

    for (const artist of parsedArtists) {
      const result = fuse.search(artist);
      if (result.length > 0 && result[0].score !== undefined && result[0].score < 0.4) {
        const dbName = result[0].item;
        const existingCards = newMatched.get(dbName) || [];
        const newCards = artistCards.get(dbName) || [];
        // 合并去重
        for (const card of newCards) {
          if (!existingCards.find((c) => c.id === card.id)) {
            existingCards.push(card);
          }
        }
        newMatched.set(dbName, existingCards);
        // 重命名为活动名单中的写法
        if (dbName !== artist) {
          newMatched.set(artist, existingCards);
          newMatched.delete(dbName);
        }
      } else {
        newUnmatched.push(artist);
      }
    }

    setMatched(newMatched);
    setUnmatched(newUnmatched);
    setMatching(false);
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

    for (const [artist, cards] of matched) {
      text += `🎨 ${artist} (${cards.length} 张)\n`;
      for (const card of cards) {
        text += `  - ${card.card_name} [${card.set_code.toUpperCase()}] ${card.deck_name}\n`;
      }
      text += "\n";
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
          <div className="flex items-center gap-2">
            <select
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border bg-background text-sm truncate"
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
            <button
              onClick={loadEvents}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              title="刷新活动列表"
            >
              🔄
            </button>
          </div>

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
                <span
                  key={a}
                  className="px-2 py-1 bg-background border rounded text-sm"
                >
                  {a}
                </span>
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
          </div>
        </CardContent>
      </Card>

      {/* 匹配结果 */}
      {hasRun && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>匹配结果</CardTitle>
                <CardDescription>
                  匹配 {matched.size}/{parsedArtists.length} 位画家
                  {matched.size > 0 &&
                    ` · 共 ${Array.from(matched.values()).reduce((s, c) => s + c.length, 0)} 张卡`}
                </CardDescription>
              </div>
              {matched.size > 0 && (
                <Button variant="outline" size="sm" onClick={exportText}>
                  <Download className="h-4 w-4 mr-2" />
                  导出清单
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {matched.size === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                没有匹配到任何画家，请确认活动名单和套牌选择是否正确
              </p>
            ) : (
              <div className="space-y-6">
                {/* 匹配到的画家 */}
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
                              <div
                                key={card.id}
                                onClick={() => toggleStatus(card.id)}
                                className={`relative w-24 rounded-lg overflow-hidden border cursor-pointer transition-all hover:scale-105 ${
                                  card.status >= 1
                                    ? card.status === 3 ? "border-pink-400" : card.status === 1 ? "border-blue-400" : "border-green-500"
                                    : "border-border hover:shadow-md"
                                }`}
                                title={{ 0: "待签", 1: "送签中", 3: "心动" }[card.status ?? 0]}
                              >
                                <div className={card.status >= 1 ? "opacity-75" : ""}>
                                  {card.image_url ? (
                                    <img
                                      src={card.image_url}
                                      alt={card.card_name}
                                      className="w-full"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="w-full aspect-[5/7] bg-accent flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                                      {card.card_name}
                                    </div>
                                  )}
                                </div>
                                {card.status >= 1 && (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div
                                      className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg ${
                                        card.status === 3
                                          ? "bg-pink-500"
                                          : card.status === 1
                                            ? "bg-blue-500"
                                            : "bg-green-500"
                                      }`}
                                    >
                                      {card.status === 3 ? "♥" : card.status === 1 ? "…" : "✓"}
                                    </div>
                                  </div>
                                )}
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center truncate">
                                  {card.card_name}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ))}

                {/* 未匹配的画家 */}
                {unmatched.length > 0 && (
                  <div className="pt-4 border-t">
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
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
