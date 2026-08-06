import "server-only";
import { getSupabase } from "@/lib/supabase";

/**
 * 更新套牌的 updated_at 为当前时间。
 * 在导入、添加、修改、删除卡牌后调用，使“上次更新”时间真正反映最后改动。
 */
export async function touchDeck(deckId: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("decks")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", deckId);

  if (error) {
    console.error("[touchDeck] 更新套牌时间失败:", error.message, "deckId:", deckId);
  }
}

export async function touchDecks(deckIds: string[]) {
  if (deckIds.length === 0) return;
  const uniqueIds = [...new Set(deckIds)];
  const supabase = getSupabase();
  const { error } = await supabase
    .from("decks")
    .update({ updated_at: new Date().toISOString() })
    .in("id", uniqueIds);

  if (error) {
    console.error("[touchDecks] 更新套牌时间失败:", error.message, "deckIds:", uniqueIds);
  }
}
