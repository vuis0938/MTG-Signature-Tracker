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
  const [loading, setLoading] = useState(true);

  // 导入表单状态
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"url" | "csv">("csv");
  const [deckName, setDeckName] = useState("");
  const [moxfieldUrl, setMoxfieldUrl] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>("");

  // 展开的套牌 + 卡牌数据
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardEntry[]>>({});
  const [cardsLoading, setCardsLoading] = useState(false);

  // 加载套牌列表
  const loadDecks = useCallback(async () => {
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setDecks(data);
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
      setImportResult("请输入套牌名称");
      return;
    }

    if (importMode === "url" && !moxfieldUrl.trim()) {
      setImportResult("请粘贴 Moxfield 套牌链接");
      return;
    }
    if (importMode === "csv" && !csvText.trim()) {
      setImportResult("请粘贴 Moxfield CSV 数据");
      return;
    }

    setImporting(true);
    setImportResult("正在导入...");

    try {
      const body: Record<string, string> = { name: deckName };
      if (importMode === "url") {
        body.url = moxfieldUrl;
      } else {
        body.csv = csvText;
      }

      const res = await fetch("/api/import-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        setImportResult(
          `✅ 导入完成！共 ${data.total} 张独特卡牌，成功 ${data.successCount} 张` +
            (data.failCount > 0 ? `，失败 ${data.failCount} 张` : "")
        );
        setDeckName("");
        setMoxfieldUrl("");
        setCsvText("");
        setShowImport(false);
        loadDecks();
      } else {
        setImportResult(`❌ 导入失败: ${data.error}`);
      }
    } catch {
      setImportResult("❌ 网络错误，请重试");
    } finally {
      setImporting(false);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">核心牌表</h1>
          <p className="text-muted-foreground">管理你的套牌和签绘清单</p>
        </div>
        <Button onClick={() => setShowImport(!showImport)} disabled={importing}>
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
              从 Moxfield 导出 CSV，粘贴内容即可导入
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 导入方式切换 */}
            <div className="flex gap-2">
              <Button
                variant={importMode === "url" ? "default" : "outline"}
                size="sm"
                onClick={() => setImportMode("url")}
              >
                🔗 粘贴链接
              </Button>
              <Button
                variant={importMode === "csv" ? "default" : "outline"}
                size="sm"
                onClick={() => setImportMode("csv")}
              >
                📄 粘贴 CSV
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deckName">套牌名称</Label>
              <Input
                id="deckName"
                placeholder="例如: Edgar Markov EDH"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </div>

            {importMode === "url" ? (
              <div className="space-y-2">
                <Label htmlFor="url">Moxfield 套牌链接（实验性）</Label>
                <Input
                  id="url"
                  placeholder="https://www.moxfield.com/decks/xxxxx"
                  value={moxfieldUrl}
                  onChange={(e) => setMoxfieldUrl(e.target.value)}
                />
                <p className="text-xs text-amber-600">
                  ⚠️ 链接方式可能因防护拦截失败，推荐使用上方 CSV 方式
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="csv">Moxfield CSV 数据</Label>
                <Textarea
                  id="csv"
                  placeholder="粘贴 Moxfield 导出的 CSV 内容..."
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "导入中..." : "开始导入"}
              </Button>
              <Button variant="outline" onClick={() => setShowImport(false)}>
                取消
              </Button>
            </div>
            {importResult && (
              <p className={`text-sm ${importResult.startsWith("✅") ? "text-green-600" : "text-destructive"}`}>
                {importResult}
              </p>
            )}
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
                      <CardTitle className="text-base">{deck.name}</CardTitle>
                      <CardDescription>
                        {new Date(deck.created_at).toLocaleDateString("zh-CN")}
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
