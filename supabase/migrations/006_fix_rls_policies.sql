-- 修复 RLS 策略冲突
-- 背景：早期迁移 002_artist_cards_cache.sql 对 card_printings / mountain_mage_curated 创建了 "Allow all" 策略，
-- 与 rls-setup.sql 中的严格策略冲突。此迁移清理冲突策略并建立正确策略。
-- 执行位置：Supabase Dashboard → SQL Editor

-- ─── card_printings ───────────────────────────────────────
ALTER TABLE card_printings ENABLE ROW LEVEL SECURITY;

-- 删除宽松的 Allow all 策略（如果存在）
DROP POLICY IF EXISTS "Allow all" ON card_printings;

-- 删除可能重复创建的旧策略，确保幂等
DROP POLICY IF EXISTS "所有人可读印刷版本缓存" ON card_printings;
DROP POLICY IF EXISTS "禁止前端写入印刷版本缓存" ON card_printings;
DROP POLICY IF EXISTS "禁止前端修改印刷版本缓存" ON card_printings;

-- 所有人可读（印刷版本信息是公共的）
CREATE POLICY "所有人可读印刷版本缓存" ON card_printings
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入印刷版本缓存" ON card_printings
  FOR INSERT WITH CHECK (false);

CREATE POLICY "禁止前端修改印刷版本缓存" ON card_printings
  FOR UPDATE USING (false);

-- ─── mountain_mage_curated ────────────────────────────────
ALTER TABLE mountain_mage_curated ENABLE ROW LEVEL SECURITY;

-- 删除宽松的 Allow all 策略（如果存在）
DROP POLICY IF EXISTS "Allow all" ON mountain_mage_curated;

-- 删除可能重复创建的旧策略，确保幂等
DROP POLICY IF EXISTS "所有人可读策展数据" ON mountain_mage_curated;
DROP POLICY IF EXISTS "禁止前端写入策展数据" ON mountain_mage_curated;

-- 所有人可读
CREATE POLICY "所有人可读策展数据" ON mountain_mage_curated
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入策展数据" ON mountain_mage_curated
  FOR ALL USING (false) WITH CHECK (false);
