"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar, MapPin, Users } from "lucide-react";

interface CalendarEvent {
  id: string;
  name: string;
  city: string;
  startDate: string;
  endDate: string;
  artists: string[];
}

export default function EventsPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">活动日历</h1>
        <p className="text-muted-foreground">
          未来活动及出席画家（数据来源：MTG Artist Connection）
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">加载中...</p>
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
                    <CardTitle className="text-base">{event.name}</CardTitle>
                    <CardDescription className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(event.startDate, event.endDate)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {event.city}
                      </span>
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
                        <span
                          key={artist}
                          className="px-2 py-1 bg-accent rounded text-sm"
                        >
                          {artist}
                        </span>
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
        数据来源：mtgartistconnection.com
        {lastUpdated && ` · 上次更新：${lastUpdated}`}
      </p>
    </div>
  );
}
