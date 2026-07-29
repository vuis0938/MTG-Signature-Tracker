"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Save, Tag, Edit3 } from "lucide-react";

type LineTag = "section" | "artist" | "ignore";

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
  const m = line.match(/deadline\s+(?:of\s+)?([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return `${defaultYear}-${String(month).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
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

    // 含 deadline 的行 → 活动标题
    if (sectionRegex.test(line)) {
      result.push({ index: i, text: line, tag: "section", artistName: "" });
      continue;
    }

    // Q1/Q2 → 忽略
    if (/^Q[1-2]\s+\d{4}/i.test(line)) {
      continue; // 完全跳过
    }

    // IN-PROGRESS → 忽略
    if (/^IN[\s-]PROGRESS/i.test(line)) continue;

    // * 开头的行 → 艺术家
    if (/^\s*\*\s+/.test(line)) {
      const name = extractArtistName(line);
      const lower = name.toLowerCase();
      if (excludePatterns.some((w) => lower.includes(w))) continue;
      if (name.length < 3) continue;
      result.push({ index: i, text: line, tag: "artist", artistName: name });
      continue;
    }

    // 其他行 → 忽略
    // 跳过，不添加到结果中
  }

  return result;
}

// ─── 页面组件 ──────────────────────────────────────────────

export default function VerifyPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [taggedLines, setTaggedLines] = useState<TaggedLine[]>([]);

  // 编辑中的章节名称覆盖
  const [sectionNameOverrides, setSectionNameOverrides] = useState<Record<number, string>>({});

  // 加载原始文本
  useEffect(() => {
    fetch("/api/events/mountain-mage?debug=1&refresh=1")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.debug?.rawText) {
          setTaggedLines(preClassify(d.debug.rawText));
        } else {
          setError(d.error || "加载失败");
        }
      })
      .catch(() => setError("网络错误"))
      .finally(() => setLoading(false));
  }, []);

  // 切换标签
  function toggleTag(lineIdx: number) {
    setTaggedLines((prev) =>
      prev.map((l) => {
        if (l.index !== lineIdx) return l;
        const next: LineTag =
          l.tag === "section" ? "artist" : l.tag === "artist" ? "ignore" : "section";
        return { ...l, tag: next };
      })
    );
    setSaved(false);
  }

  // ── 从 taggedLines 构建章节结构 ──
  const sections = useMemo(() => {
    const result: Section[] = [];
    let currentSection: Section | null = null;

    for (let i = 0; i < taggedLines.length; i++) {
      const line = taggedLines[i];

      if (line.tag === "section") {
        // 保存前一章节
        if (currentSection && currentSection.artists.length > 0) {
          result.push(currentSection);
        }
        const year = parseYear(line.text);
        currentSection = {
          name: sectionNameOverrides[line.index] || line.text.replace(/\s*\(.*/, "").trim(),
          deadline: parseDeadline(line.text, year),
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
  }, [taggedLines, sectionNameOverrides]);

  // 保存
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/events/mountain-mage/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
      }
    } catch {
      // ignore
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
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Mountain Mage 策展</h1>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">已保存</span>}
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
      <div className="grid grid-cols-4 gap-2 mb-4">
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
      </div>

      {/* 双栏对比 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左栏：可编辑的原始文本 */}
        <div className="rounded-lg border">
          <div className="px-4 py-2 border-b bg-accent/30 font-medium text-sm flex items-center gap-2">
            <Tag className="h-3.5 w-3.5" />
            原始文本（点击行切换标签）
            <span className="text-xs text-muted-foreground font-normal ml-auto">
              蓝=活动 · 绿=画家 · 灰=忽略
            </span>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed select-none">
            {taggedLines.map((line) => {
              const tag = tagLabel[line.tag];
              const displayName = line.tag === "artist" ? line.artistName : line.text;

              return (
                <div
                  key={line.index}
                  onClick={() => toggleTag(line.index)}
                  className={`flex items-center gap-2 px-1 py-0.5 rounded my-0.5 cursor-pointer hover:ring-1 hover:ring-ring transition-all ${tag.color}`}
                >
                  <span className="shrink-0 text-[10px] font-medium px-1 py-0 rounded bg-background/50">
                    {tag.label}
                  </span>
                  {line.tag === "section" && (
                    <span className="shrink-0 opacity-50" title="活动标题">
                      <Edit3 className="h-3 w-3" />
                    </span>
                  )}
                  <span className="truncate">{displayName}</span>
                </div>
              );
            })}
            {taggedLines.length === 0 && (
              <p className="text-muted-foreground text-center py-8">无数据</p>
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
                {sections.map((section, si) => (
                  <div key={section.name + si}>
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-sm">{section.name}</h3>
                      {section.deadline && (
                        <span className="text-xs text-muted-foreground">
                          截止 {section.deadline}
                        </span>
                      )}
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
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}