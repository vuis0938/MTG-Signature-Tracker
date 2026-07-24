"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Upload, Trash2, ChevronDown, ChevronRight } from "lucide-react";

interface Deck {
  id: string;
  name: string;
  source: string;
  created_at: string;
}

interface DeckStats {
  total: number;
  unsigned: number;
}

interface CardEntry {
  id: string;
  card_name: string;
  set_code: string;
  collector_number: string;
  artist_names: string[];
  image_url: string | null;
  is_signed: boolean;
}

export default function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckStats, setDeckStats] = useState<Record<string, DeckStats>>({});
  const [loading, setLoading] = useState(true);

  // 导入表单状态
  const [showImport, setShowImport] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckText, setDeckText] = useState("");
  const [importing, setImporting] = useState(false);

  // Toast 通知
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(
    null
  );

  // 导入失败卡牌的手动重试
  const [failedCards, setFailedCards] = useState<
    Array<{ name: string; setCode: string; collectorNumber: string }>
  >([]);
  const [retryingDeckId, setRetryingDeckId] = useState<string | null>(null);
  const [retryingCard, setRetryingCard] = useState<string | null>(null);
  const [retryNotes, setRetryNotes] = useState<Record<string, string>>({});

  // 展开的套牌 + 卡牌数据
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardEntry[]>>({});
  const [cardsLoading, setCardsLoading] = useState(false);

  // 加载套牌列表 + 每套牌的统计
  const loadDecks = useCallback(async () => {
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setDecks(data);

      // 并发获取每套牌的计数
      const statsMap: Record<string, DeckStats> = {};
      await Promise.all(
        data.map(async (deck) => {
          const [{ count: total }, { count: unsigned }] = await Promise.all([
            supabase
              .from("cards")
              .select("*", { count: "exact", head: true })
              .eq("deck_id", deck.id),
            supabase
              .from("cards")
              .select("*", { count: "exact", head: true })
              .eq("deck_id", deck.id)
              .eq("is_signed", false),
          ]);
          statsMap[deck.id] = {
            total: total ?? 0,
            unsigned: unsigned ?? 0,
          };
        })
      );
      setDeckStats(statsMap);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  // 展开/收起套牌详情
  async function toggleDeck(deckId: string) {
    if (expandedDeck === deckId) {
      setExpandedDeck(null);
      return;
    }

    setExpandedDeck(deckId);

    // 如果还没加载过这个套牌的卡牌，加载之
    if (!cards[deckId]) {
      setCardsLoading(true);
      const { data } = await supabase
        .from("cards")
        .select("*")
        .eq("deck_id", deckId)
        .order("artist_names");

      if (data) {
        setCards((prev) => ({ ...prev, [deckId]: data }));
      }
      setCardsLoading(false);
    }
  }

  // 删除套牌
  async function deleteDeck(deckId: string) {
    if (!confirm("确定要删除这套牌吗？所有卡牌数据将被永久删除。")) return;

    await supabase.from("decks").delete().eq("id", deckId);
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    setCards((prev) => {
      const next = { ...prev };
      delete next[deckId];
      return next;
    });
    if (expandedDeck === deckId) setExpandedDeck(null);
  }

  // 导入套牌
  async function handleImport() {
    if (!deckName.trim()) {
      setToast({ message: "请输入套牌名称", type: "error" });
      return;
    }
    if (!deckText.trim()) {
      setToast({ message: "请粘贴 Moxfield 牌表内容", type: "error" });
      return;
    }

    setImporting(true);

    try {
      const res = await fetch("/api/import-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deckName, text: deckText }),
      });

      const data = await res.json();

      if (data.success) {
        const t = data.timing;
        const hasFailures = data.failCount > 0;
        const msg =
          `✅ 「${deckName}」${data.successCount}/${data.total} 张成功` +
          (hasFailures ? `，${data.failCount} 张未找到` : "") +
          ` | ${t.total}`;

        setToast({ message: msg, type: hasFailures ? "error" : "success" });

        // 保存失败卡牌供手动重试
        if (hasFailures && data.failedCards) {
          setFailedCards(data.failedCards);
          setRetryingDeckId(data.deckId);
        } else {
          setFailedCards([]);
          setRetryingDeckId(null);
        }

        setDeckName("");
        setDeckText("");
        setShowImport(false);
        await loadDecks();
      } else {
        setToast({ message: data.error, type: "error" });
      }
    } catch {
      setToast({ message: "网络错误，请重试", type: "error" });
    } finally {
      setImporting(false);
    }
  }

  // 手动重试单张卡牌（模糊搜索）
  async function retryCard(cardName: string, setCode: string, collectorNumber: string) {
    if (!retryingDeckId) return;
    setRetryingCard(cardName);

    try {
      const res = await fetch("/api/retry-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckId: retryingDeckId, cardName, setCode, collectorNumber }),
      });
      const data = await res.json();

      if (data.success) {
        // 从失败列表移除
        setFailedCards((prev) => prev.filter((c) => c.name !== cardName));
        // 记录备注
        if (data.note) {
          setRetryNotes((prev) => ({ ...prev, [cardName]: data.note }));
        }
        // 刷新卡牌显示
        if (expandedDeck === retryingDeckId) {
          toggleDeck(retryingDeckId);
        }
      } else {
        setRetryNotes((prev) => ({ ...prev, [cardName]: `❌ ${data.error}` }));
      }
    } catch {
      setRetryNotes((prev) => ({ ...prev, [cardName]: "❌ 网络错误" }));
    } finally {
      setRetryingCard(null);
    }
  }

  // 按画家分组
  function groupCardsByArtist(cardList: CardEntry[]): Map<string, CardEntry[]> {
    const map = new Map<string, CardEntry[]>();
    for (const card of cardList) {
      const artists = card.artist_names;
      for (const artist of artists) {
        const existing = map.get(artist) || [];
        existing.push(card);
        map.set(artist, existing);
      }
    }
    return map;
  }

  return (
    <div className="space-y-6">
      {/* Toast 通知 */}
      {toast && (
        <div
          className={`p-3 rounded-lg text-sm ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-3 text-current opacity-50 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">核心牌表</h1>
          <p className="text-muted-foreground">管理你的套牌和签绘清单</p>
        </div>
        <Button
          onClick={() => {
            setShowImport(!showImport);
            if (!showImport) {
              setDeckName("");
              setDeckText("");
            }
          }}
          disabled={importing}
        >
          <Upload className="h-4 w-4 mr-2" />
          导入套牌
        </Button>
      </div>

      {/* 导入表单 */}
      {showImport && (
        <Card>
          <CardHeader>
            <CardTitle>导入 Moxfield 套牌</CardTitle>
            <CardDescription>
              在 Moxfield 套牌页面点击 <b>Copy for Moxfield</b>，粘贴到下方即可导入
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deckName">套牌名称</Label>
              <Input
                id="deckName"
                placeholder="例如: Edgar Markov EDH"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">牌表内容</Label>
              <Textarea
                id="text"
                placeholder={`粘贴 Copy for Moxfield 的内容，格式如下：
1 Sol Ring (CMM) 345
1 Arcane Signet (ELD) 314
1 Command Tower (CMR) 350 *F*
...`}
                rows={8}
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                💡 Moxfield 套牌页面点 <b>Copy for Moxfield</b> → 直接粘贴到这里。含系列代码和编号，100% 精准匹配你的实体卡版本。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "导入中..." : "开始导入"}
              </Button>
              <Button variant="outline" onClick={() => setShowImport(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 导入失败的卡牌 — 手动重试 */}
      {failedCards.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base">
              ⚠️ {failedCards.length} 张卡牌未找到
            </CardTitle>
            <CardDescription>
              精确定位失败，可手动触发模糊搜索。注意：模糊搜索可能返回不同版本，请确认画家是否正确。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {failedCards.map((card) => (
                <div
                  key={card.name}
                  className="flex items-center justify-between gap-3 py-2 border-b border-amber-100 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{card.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {card.setCode} / {card.collectorNumber}
                    </p>
                    {retryNotes[card.name] && (
                      <p className="text-xs mt-1 text-amber-700">{retryNotes[card.name]}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryingCard === card.name}
                    onClick={() => retryCard(card.name, card.setCode, card.collectorNumber)}
                  >
                    {retryingCard === card.name ? "搜索中..." : "模糊搜索"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 套牌列表 */}
      {loading ? (
        <p className="text-muted-foreground text-center py-12">加载中...</p>
      ) : decks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            暂无套牌数据，点击"导入套牌"开始
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {decks.map((deck) => (
            <Card key={deck.id}>
              <CardHeader
                className="cursor-pointer hover:bg-accent/50 rounded-t-lg"
                onClick={() => toggleDeck(deck.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expandedDeck === deck.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <div>
                      <CardTitle className="text-base">
                        {deck.name}
                        {deckStats[deck.id] && (
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            ({deckStats[deck.id].unsigned}/{deckStats[deck.id].total})
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>
                        {new Date(deck.created_at).toLocaleDateString("zh-CN")}
                        {deckStats[deck.id] && (
                          <span className="ml-2">
                            {deckStats[deck.id].unsigned > 0
                              ? `${deckStats[deck.id].unsigned} 张待签`
                              : deckStats[deck.id].total > 0
                                ? "🎉 全部已签"
                                : ""}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDeck(deck.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </CardHeader>

              {/* 展开的卡牌列表（按画家分组） */}
              {expandedDeck === deck.id && (
                <CardContent>
                  {cardsLoading ? (
                    <p className="text-muted-foreground text-sm">加载卡牌...</p>
                  ) : cards[deck.id]?.length === 0 ? (
                    <p className="text-muted-foreground text-sm">暂无卡牌</p>
                  ) : (
                    <div className="space-y-4">
                      {Array.from(
                        groupCardsByArtist(cards[deck.id] || [])
                      ).map(([artist, artistCards]) => (
                        <div key={artist}>
                          <h4 className="text-sm font-medium mb-2">
                            🎨 {artist} ({artistCards.length})
                          </h4>
                          <div className="flex flex-wrap gap-3">
                            {artistCards.map((card) => (
                              <div
                                key={card.id}
                                className={`relative w-24 rounded-lg overflow-hidden border ${
                                  card.is_signed
                                    ? "opacity-50 border-green-500"
                                    : "border-border"
                                }`}
                              >
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
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 text-center">
                                  {card.card_name}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
