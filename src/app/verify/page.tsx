"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Save, Tag, Edit3, RefreshCw, Lock, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/lib/toast-context";
import { useUser } from "@/lib/user-context";

type LineTag = "section" | "artist" | "ignore" | "terminate";

interface TaggedLine {
  index: number;
  text: string;
  tag: LineTag;
  /** 提取的艺术家名称（仅 artist 行有效） */
  artistName: string;
}

interface Section {
  name: string;
  deadline: string | null;
  artists: string[];
}

// ─── 工具函数 ──────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseDeadline(line: string, defaultYear: number): string | null {
  // 先尝试匹配带具体日期的格式
  const withDay = line.match(/deadline\s+(?:of\s+)?([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (withDay) {
    const month = MONTH_MAP[withDay[1].toLowerCase()];
    if (month) return `${defaultYear}-${String(month).padStart(2, "0")}-${String(parseInt(withDay[2], 10)).padStart(2, "0")}`;
  }

  // 再尝试匹配模糊日期 "sometime in Month"
  const vague = line.match(/deadline\s+sometime\s+in\s+([A-Z][a-z]+)/i);
  if (vague) {
    const month = MONTH_MAP[vague[1].toLowerCase()];
    if (month) return `${defaultYear}-${String(month).padStart(2, "0")}`;
  }

  return null;
}

function parseYear(line: string): number {
  const m = line.match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

function extractArtistName(line: string): string {
  const m = line.match(/^\s*\*\s+(.+)$/);
  if (!m) return line;
  let name = m[1].trim();
  const parenIdx = name.indexOf("(");
  if (parenIdx > 0) name = name.slice(0, parenIdx).trim();
  return name;
}

// ─── 预分类逻辑 ────────────────────────────────────────────
// 所有非空行全部展示，AI 仅做预标记作为起点，用户手动修正

function preClassify(rawText: string): TaggedLine[] {
  const lines = rawText.split(/\r?\n/);
  const result: TaggedLine[] = [];
  const sectionRegex = /deadline/i;
  const excludePatterns = [
    "shipping", "please use the following", "please note",
    "signing schedule", "thanks", "thank you", "return", "contact",
    "cards must", "all cards", "mountainmage", "important",
    "upcoming signings", "and info/rules", "info/rules",
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 3) continue;

    let tag: LineTag = "ignore";
    let artistName = "";

    // 终止标签：长下划线分隔符
    if (/^_{5,}$/.test(line)) {
      tag = "terminate";
    }
    // 终止标签：Status on In-Progress Signings（排除文档标题中同时含 Upcoming 的行）
    else if (/status\s+on\s+in[-]?progress\s+signings/i.test(line) && !/upcoming/i.test(line)) {
      tag = "terminate";
    }
    // 终止标签：整行仅为 "deadline sometime in Xxx:" 的模糊截止日期
    else if (/^deadline\s+sometime\s+in\s+[A-Z][a-z]+:?\s*$/i.test(line)) {
      tag = "terminate";
    }
    // 含 deadline 的行 → 预标记为活动标题
    else if (sectionRegex.test(line)) {
      tag = "section";
    }
    // Q1/Q2 → 预标记为忽略（但保留在列表中）
    else if (/^Q[1-2]\s+\d{4}/i.test(line)) {
      tag = "ignore";
    }
    // IN-PROGRESS → 预标记为忽略
    else if (/^IN[\s-]PROGRESS/i.test(line)) {
      tag = "ignore";
    }
    // UPCOMING SIGNINGS 标题 → 忽略
    else if (/^UPCOMING\s+SIGNINGS/i.test(line)) {
      tag = "ignore";
    }
    // 子章节（Tokyo MTG / Kazuki）→ 预标记为忽略，用户可手动改为活动
    else if (/^(Tokyo\s+MTG|Kazuki)/i.test(line)) {
      tag = "ignore";
    }
    // * 开头的行 → 预标记为艺术家
    else if (/^\s*\*\s+/.test(line)) {
      const name = extractArtistName(line);
      const lower = name.toLowerCase();
      if (excludePatterns.some((w) => lower.includes(w)) || name.length < 3) {
        tag = "ignore";
      } else {
        tag = "artist";
        artistName = name;
      }
    }

    result.push({ index: i, text: line, tag, artistName });
  }

  return result;
}

// ─── 页面组件 ──────────────────────────────────────────────

export default function VerifyPage() {
  const { toast: showToast } = useToast();
  const { isAdmin, ready } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [taggedLines, setTaggedLines] = useState<TaggedLine[]>([]);
  const [hideIgnored, setHideIgnored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 从 Google Docs 重新抓取原始文本并 AI 预分类（覆盖当前标签）
  async function handleRefresh() {
    if (!window.confirm("将从 Google Docs 重新抓取最新数据，当前未保存的标签将丢失。确定继续？")) return;
    setRefreshing(true);
    setSaved(false);
    try {
      const rawRes = await fetch("/api/events/mountain-mage?raw=1&refresh=1");
      const rawData = await rawRes.json();
      if (rawData.success && rawData.rawText) {
        setTaggedLines(preClassify(rawData.rawText));
        setSectionNameOverrides({});
        setDeadlineOverrides({});
      } else {
        setError(rawData.error || "抓取失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setRefreshing(false);
    }
  }

  // 编辑中的章节名称覆盖
  const [sectionNameOverrides, setSectionNameOverrides] = useState<Record<number, string>>({});
  // 编辑中的截止日期覆盖
  const [deadlineOverrides, setDeadlineOverrides] = useState<Record<number, string>>({});

  // 找到第一个终止标签的位置，之后所有行视为忽略
  const terminateIndex = useMemo(() => {
    const idx = taggedLines.findIndex((l) => l.tag === "terminate");
    return idx === -1 ? taggedLines.length : idx;
  }, [taggedLines]);

  // 过滤后的行（终止标签之后的全隐藏，除非用户要求显示全部）
  const visibleLines = useMemo(() => {
    const beforeTerminate = hideIgnored
      ? taggedLines.slice(0, terminateIndex + 1).filter((l) => l.tag !== "ignore")
      : taggedLines.slice(0, terminateIndex + 1);
    return beforeTerminate;
  }, [taggedLines, hideIgnored, terminateIndex]);

  // 加载原始文本
  useEffect(() => {
    async function load() {
      try {
        // 1. 先尝试读取已保存的策展数据
        const curRes = await fetch("/api/events/mountain-mage/curate");
        const curData = await curRes.json();

        if (curData.success && curData.taggedLines && curData.taggedLines.length > 0) {
          // 恢复已保存的标签状态
          const restored = curData.taggedLines as TaggedLine[];
          setTaggedLines(restored);
          if (curData.deadlineOverrides) {
            setDeadlineOverrides(curData.deadlineOverrides);
          }
          setSaved(true);
          setLoading(false);
          return;
        }

        // 2. 无已保存数据，从 Google Docs 重新抓取并 AI 预分类
        const rawRes = await fetch("/api/events/mountain-mage?raw=1&refresh=1");
        const rawData = await rawRes.json();
        if (rawData.success && rawData.rawText) {
          setTaggedLines(preClassify(rawData.rawText));
        } else {
          setError(rawData.error || "加载失败");
        }
      } catch {
        setError("网络错误，请重试");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // 切换标签（4 路循环：section → artist → ignore → terminate → section）
  function toggleTag(lineIdx: number) {
    setTaggedLines((prev) =>
      prev.map((l) => {
        if (l.index !== lineIdx) return l;
        const cycle: LineTag[] = ["section", "artist", "ignore", "terminate"];
        const curIdx = cycle.indexOf(l.tag);
        const next = cycle[(curIdx + 1) % cycle.length];
        return { ...l, tag: next };
      })
    );
    setSaved(false);
  }

  // ── 从 taggedLines 构建章节结构 ──
  // 遇到终止标签后停止处理
  const sections = useMemo(() => {
    const result: Section[] = [];
    let currentSection: Section | null = null;

    for (let i = 0; i < taggedLines.length; i++) {
      const line = taggedLines[i];

      // 终止标签：停止处理后续内容
      if (line.tag === "terminate") break;

      if (line.tag === "section") {
        // 保存前一章节
        if (currentSection && currentSection.artists.length > 0) {
          result.push(currentSection);
        }
        const year = parseYear(line.text);
        currentSection = {
          name: sectionNameOverrides[line.index] || line.text.replace(/\*+/g, "").replace(/\s*\(.*/, "").trim(),
          deadline: deadlineOverrides[line.index] !== undefined
            ? deadlineOverrides[line.index]
            : parseDeadline(line.text, year),
          artists: [],
        };
      } else if (line.tag === "artist" && currentSection) {
        currentSection.artists.push(line.artistName);
      }
    }

    if (currentSection && currentSection.artists.length > 0) {
      result.push(currentSection);
    }

    return result;
  }, [taggedLines, sectionNameOverrides, deadlineOverrides]);

  // 保存
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/events/mountain-mage/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, taggedLines, deadlineOverrides }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
      } else {
        showToast("保存失败，请重试", "error");
      }
    } catch {
      showToast("网络错误，请重试", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载中...
      </div>
    );
  }

  // 等待客户端 cookie 读取完成（避免 isAdmin 初始 false 导致权限闪烁）
  if (!ready) {
    return (
      <div className="flex items-center justify-center gap-2 min-h-screen text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载中...
      </div>
    );
  }

  // 非管理员无法访问策展页面
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-screen text-muted-foreground">
        <Lock className="h-8 w-8" />
        <p className="text-base font-medium">需要管理员权限</p>
        <p className="text-sm">此页面仅限管理员访问，普通用户无权修改策展数据</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen text-red-500">
        {error}
      </div>
    );
  }

  const tagLabel: Record<LineTag, { label: string; color: string }> = {
    section: { label: "活动", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    artist: { label: "画家", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    ignore: { label: "忽略", color: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
    terminate: { label: "终止", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <h1 className="text-xl font-semibold">Mountain Mage 策展</h1>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">已保存</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-md hover:bg-accent disabled:opacity-50"
            title="从 Google Docs 重新抓取最新数据，覆盖当前标签"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "抓取中..." : "刷新"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-6 gap-2 mb-4">
        <div className="rounded border px-3 py-2 text-center">
          <div className="text-lg font-bold">{taggedLines.length}</div>
          <div className="text-xs text-muted-foreground">总行数</div>
        </div>
        <div className="rounded border px-3 py-2 text-center">
          <div className="text-lg font-bold">{sections.length}</div>
          <div className="text-xs text-muted-foreground">活动</div>
        </div>
        <div className="rounded border px-3 py-2 text-center">
          <div className="text-lg font-bold text-emerald-600">
            {taggedLines.filter((l) => l.tag === "artist").length}
          </div>
          <div className="text-xs text-muted-foreground">画家</div>
        </div>
        <div className="rounded border px-3 py-2 text-center">
          <div className="text-lg font-bold text-amber-600">
            {taggedLines.filter((l) => l.tag === "ignore").length}
          </div>
          <div className="text-xs text-muted-foreground">已忽略</div>
        </div>
        <div className="rounded border px-3 py-2 text-center">
          <div className="text-lg font-bold text-muted-foreground">
            {taggedLines.filter((l) => l.tag === "section").length}
          </div>
          <div className="text-xs text-muted-foreground">活动标题</div>
        </div>
        <div className="rounded border px-3 py-2 text-center">
          <div className="text-lg font-bold text-red-500">
            {taggedLines.length - terminateIndex - 1}
          </div>
          <div className="text-xs text-muted-foreground">终止后</div>
        </div>
      </div>

      {/* 双栏对比 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左栏：可编辑的原始文本 */}
        <div className="rounded-lg border">
          <div className="px-4 py-2 border-b bg-accent/30 font-medium text-sm flex items-center gap-2">
            <Tag className="h-3.5 w-3.5" />
            原始文本（点击行切换标签）
            <span className="text-xs text-muted-foreground font-normal ml-auto">
              蓝=活动 · 绿=画家 · 灰=忽略 · 红=终止
            </span>
          </div>
          <div className="px-3 py-1.5 border-b bg-background flex items-center gap-2">
            <button
              onClick={() => setHideIgnored(!hideIgnored)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                hideIgnored
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {hideIgnored ? "显示全部" : "隐藏已忽略"}
            </button>
            <span className="text-xs text-muted-foreground">
              {hideIgnored
                ? `显示 ${visibleLines.length} / ${taggedLines.length} 行`
                : terminateIndex < taggedLines.length - 1
                  ? `共 ${taggedLines.length} 行，终止后隐藏 ${taggedLines.length - terminateIndex - 1} 行`
                  : `共 ${taggedLines.length} 行`}
            </span>
          </div>
          <div className="p-3 max-h-[65vh] overflow-y-auto font-mono text-xs leading-relaxed select-none">
            {visibleLines.map((line) => {
              const tag = tagLabel[line.tag];
              const displayName = line.tag === "artist" ? line.artistName : line.text;
              const isTerminate = line.tag === "terminate";

              return (
                <div key={line.index}>
                  <div
                    onClick={() => toggleTag(line.index)}
                    className={`flex items-center gap-2 px-1 py-0.5 rounded my-0.5 cursor-pointer hover:ring-1 hover:ring-ring transition-all ${tag.color}`}
                  >
                    <span className="shrink-0 text-xs font-medium px-1 py-0 rounded bg-background/50">
                      {tag.label}
                    </span>
                    {line.tag === "section" && (
                      <span className="shrink-0 opacity-50" title="活动标题">
                        <Edit3 className="h-3 w-3" />
                      </span>
                    )}
                    <span className="truncate">{displayName}</span>
                  </div>
                  {isTerminate && (
                    <div className="border-t-2 border-dashed border-red-300 dark:border-red-700 my-1 mx-2" />
                  )}
                </div>
              );
            })}
            {taggedLines.length === 0 && (
              <p className="text-muted-foreground text-center py-8">无数据</p>
            )}
            {taggedLines.length > 0 && visibleLines.length === 0 && (
              <p className="text-muted-foreground text-center py-8">
                所有行均已忽略，点击「显示全部」查看
              </p>
            )}
          </div>
        </div>

        {/* 右栏：结构化预览 */}
        <div className="rounded-lg border">
          <div className="px-4 py-2 border-b bg-accent/30 font-medium text-sm">
            结构化预览 · {sections.length} 个活动 ·{" "}
            {sections.reduce((sum, s) => sum + s.artists.length, 0)} 位画家
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                请在左侧标记活动标题和画家
              </p>
            ) : (
              <div className="space-y-4">
                {sections.map((section, si) => {
                  // 找到对应 section 行的 index
                  const sectionLine = taggedLines.find(
                    (l) => l.tag === "section" && l.text.includes(section.name)
                  );
                  const sectionIndex = sectionLine?.index;

                  return (
                  <div key={section.name + si}>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-sm">{section.name}</h3>
                      <input
                        type="text"
                        placeholder="YYYY-MM-DD"
                        value={
                          sectionIndex !== undefined
                            ? (deadlineOverrides[sectionIndex] ?? section.deadline ?? "")
                            : (section.deadline ?? "")
                        }
                        onChange={(e) => {
                          if (sectionIndex !== undefined) {
                            setDeadlineOverrides((prev) => ({
                              ...prev,
                              [sectionIndex]: e.target.value,
                            }));
                            setSaved(false);
                          }
                        }}
                        className="text-xs w-28 px-1.5 py-0.5 border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-xs bg-accent px-1.5 py-0.5 rounded">
                        {section.artists.length} 位
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {section.artists.map((artist) => (
                        <span
                          key={artist}
                          className="inline-flex text-xs px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                        >
                          {artist}
                        </span>
                      ))}
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}