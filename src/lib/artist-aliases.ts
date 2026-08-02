import "server-only";
import { getSupabase } from "@/lib/supabase";

/**
 * 从数据库加载画家别名映射
 * 返回 Map<alias_lowercase, canonical_name>
 */
export async function loadArtistAliases(): Promise<Map<string, string>> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("artist_aliases")
      .select("alias, canonical_name");

    if (error || !data) return new Map();

    const map = new Map<string, string>();
    for (const row of data) {
      map.set(row.alias.toLowerCase().trim(), row.canonical_name.trim());
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * 将输入的画家名通过别名映射转换为标准名称
 * 如果没有匹配的别名，返回原始名称
 */
export function resolveAlias(
  artistName: string,
  aliasMap: Map<string, string>,
): string {
  const key = artistName.toLowerCase().trim();
  return aliasMap.get(key) || artistName;
}

/**
 * 批量转换画家名列表
 */
export function resolveAliases(
  artists: string[],
  aliasMap: Map<string, string>,
): string[] {
  return artists.map((a) => resolveAlias(a, aliasMap));
}
