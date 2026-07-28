"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
} from "@/components/ui/dialog";
import { Calendar, MapPin, Users, Loader2, Package, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtistCard, CalendarEvent } from "@/types";

export default function EventsPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 画家卡牌弹窗
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [artistCards, setArtistCards] = useState<ArtistCard[]>([]);
  const [artistCardsLoading, setArtistCardsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setEvents(data.events);
        setLastUpdated(new Date().toLocaleString("zh-CN"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) =>
      `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    if (fmt(s) === fmt(e)) return fmt(s);
    return `${fmt(s)} — ${fmt(e)}`;
  };

  // 点击画家名，加载其所有卡牌
  async function handleArtistClick(artist: string) {
    setSelectedArtist(artist);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">活动日历</h1>
        <p className="text-muted-foreground">
          未来活动及出席画家
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">暂无未来活动</p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader
                className="cursor-pointer hover:bg-accent/50 rounded-t-lg"
                onClick={() => toggleExpand(event.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{event.name}</CardTitle>
                      {event.source === "mountain_mage" && (
                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <Package className="h-3 w-3" />
                          代理签绘
                        </span>
                      )}
                      {event.status === "in_progress" && (
                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          <Clock className="h-3 w-3" />
                          进行中
                        </span>
                      )}
                    </div>
                    <CardDescription className="flex items-center gap-3">
                      {event.source === "mtgac" ? (
                        <>
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(event.startDate, event.endDate || event.startDate)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {event.city}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {event.city}
                          </span>
                        </>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {event.artists.length} 位画家
                      </span>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              {expanded.has(event.id) && (
                <CardContent>
                  {event.artists.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无画家信息</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {event.artists.map((artist) => (
                        <Button
                          key={artist}
                          variant="outline"
                          size="sm"
                          className="bg-accent border-black hover:bg-accent/70"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArtistClick(artist);
                          }}
                        >
                          {artist}
                        </Button>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pt-4">
        数据来源：mtgartistconnection.com · mountainmagesigs.com
        {lastUpdated && ` · 上次更新：${lastUpdated}`}
      </p>

      {/* ─── 画家卡牌画廊弹窗 ─── */}
      <Dialog open={selectedArtist !== null} onOpenChange={() => { setSelectedArtist(null); setArtistCards([]); }} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{selectedArtist} 的卡牌</DialogTitle>
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
                    <div className="p-1.5 text-xs">
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
