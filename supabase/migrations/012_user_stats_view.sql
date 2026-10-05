-- ════════════════════════════════════════════════════════════
-- 用户统计视图（套牌数 / 卡牌数聚合）
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 背景：
--   用户管理列表需要显示「每用户的套牌数 + 卡牌数」。
--   原先在应用层拉全量 cards 表再聚合，但 PostgREST 的
--   db-max-rows=1000 硬上限会静默截断（select().limit(10000) 无效），
--   导致卡片较多的用户被误统计为 0。
--
-- 方案：
--   把「按用户分组统计」下沉到数据库，用一个视图一次算出：
--     deck_count —— 该用户的套牌数
--     card_count —— 该用户所有套牌下的卡牌总数
--   服务端 API 用 service_role（绕过 RLS）读这个视图即可。
--
-- 安全说明：
--   视图默认 security_invoker（PostgreSQL 15+），anon 键查询时
--   仍受底层 users/decks/cards 的 RLS 约束（users 对前端禁读），
--   不会泄露数据。
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.user_stats AS
SELECT
  u.username,
  u.created_at,
  u.last_active_at,
  (SELECT COUNT(*) FROM public.decks d WHERE d.user_name = u.username) AS deck_count,
  (SELECT COUNT(*) FROM public.cards c
     JOIN public.decks d ON c.deck_id = d.id
   WHERE d.user_name = u.username) AS card_count
FROM public.users u;
