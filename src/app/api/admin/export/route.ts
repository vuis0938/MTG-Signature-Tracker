import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, logAdminAction } from "@/lib/admin";

/**
 * CSV 字段转义（RFC 4180）
 *
 * 规则：
 * - 字段包含逗号、双引号或换行符时，用双引号包裹
 * - 字段内的双引号转义为两个双引号
 * - 防止公式注入：以 = + - @ 开头的字段前加单引号前缀
 */
function escapeCsvField(value: unknown): string {
  let str = String(value ?? "");

  // 防止 CSV 公式注入（= + - @ 开头的值在 Excel 中会被当作公式执行）
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }

  // 包含逗号、双引号或换行符时需要引号包裹
  if (/[",\n\r]/.test(str)) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/** 将行数据转为 CSV 行 */
function toCsvRow(headers: string[], row: Record<string, unknown>): string {
  return headers.map((h) => escapeCsvField(row[h])).join(",");
}

// GET: 全局数据导出（JSON 格式）
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth.error) return auth.error;
  const adminName = auth.userName;

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json"; // json | csv
    const dataType = searchParams.get("type") || "all"; // all | users | decks | cards

    const supabase = getSupabase();
    const exportData: Record<string, unknown> = {};
    const timestamp = new Date().toISOString();

    // 根据类型选择性导出
    if (dataType === "all" || dataType === "users") {
      const { data: users } = await supabase
        .from("users")
        .select("username, created_at, last_active_at")
        .order("created_at", { ascending: false });
      exportData.users = users || [];
    }

    if (dataType === "all" || dataType === "decks") {
      const { data: decks } = await supabase
        .from("decks")
        .select("*")
        .order("created_at", { ascending: false });
      exportData.decks = decks || [];
    }

    if (dataType === "all" || dataType === "cards") {
      const { data: cards } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50000);
      exportData.cards = cards || [];
    }

    if (dataType === "all") {
      const { data: events } = await supabase
        .from("events")
        .select("*")
        .order("date", { ascending: false });
      exportData.events = events || [];

      const { data: aliases } = await supabase
        .from("artist_aliases")
        .select("*")
        .order("canonical_name", { ascending: true });
      exportData.artistAliases = aliases || [];

      const { data: announcements } = await supabase
        .from("announcements")
        .select("id, title, content, type, active, created_at, expires_at")
        .order("created_at", { ascending: false });
      exportData.announcements = announcements || [];
    }

    await logAdminAction(adminName, "data_export", dataType, { format });

    if (format === "csv") {
      // CSV 格式导出（仅支持单表）
      if (dataType === "users" && Array.isArray(exportData.users)) {
        const rows = exportData.users as Record<string, unknown>[];
        const headers = ["username", "created_at", "last_active_at"];
        const csv = [
          headers.join(","),
          ...rows.map((r) => toCsvRow(headers, r)),
        ].join("\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="users_${timestamp.split("T")[0]}.csv"`,
          },
        });
      }
      if (dataType === "decks" && Array.isArray(exportData.decks)) {
        const rows = exportData.decks as Record<string, unknown>[];
        const headers = ["id", "name", "user_name", "created_at"];
        const csv = [
          headers.join(","),
          ...rows.map((r) => toCsvRow(headers, r)),
        ].join("\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="decks_${timestamp.split("T")[0]}.csv"`,
          },
        });
      }
    }

    // 默认 JSON 格式
    const jsonStr = JSON.stringify({
      title: "MTG签绘管家",
      url: "https://www.mtgkit.top",
      exportedAt: timestamp,
      exportedBy: adminName,
      ...exportData,
    }, null, 2);

    return new NextResponse(jsonStr, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mtg_export_${timestamp.split("T")[0]}.json"`,
      },
    });
  } catch (err) {
    console.error("[Admin Export API]", err);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
