-- 模糊匹配缓存表
-- 在 Supabase Dashboard → SQL Editor 中执行此 SQL

CREATE TABLE IF NOT EXISTS card_printings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_name TEXT NOT NULL UNIQUE,
  printings JSONB NOT NULL DEFAULT '[]',
  all_artists TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_printings_name ON card_printings (card_name);

ALTER TABLE card_printings ENABLE ROW LEVEL SECURITY;

-- 所有人可读（印刷版本信息是公共的）
CREATE POLICY "所有人可读印刷版本缓存" ON card_printings
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入印刷版本缓存" ON card_printings
  FOR INSERT WITH CHECK (false);

CREATE POLICY "禁止前端修改印刷版本缓存" ON card_printings
  FOR UPDATE USING (false);

-- Mountain Mage 人工策展数据表
CREATE TABLE IF NOT EXISTS mountain_mage_curated (
  id TEXT PRIMARY KEY DEFAULT 'mountain_mage',
  sections JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mountain_mage_curated ENABLE ROW LEVEL SECURITY;

-- 所有人可读
CREATE POLICY "所有人可读策展数据" ON mountain_mage_curated
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入策展数据" ON mountain_mage_curated
  FOR ALL USING (false) WITH CHECK (false);