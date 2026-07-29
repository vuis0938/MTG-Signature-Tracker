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

CREATE POLICY "Allow all" ON card_printings FOR ALL USING (true) WITH CHECK (true);

-- Mountain Mage 人工策展数据表
CREATE TABLE IF NOT EXISTS mountain_mage_curated (
  id TEXT PRIMARY KEY DEFAULT 'mountain_mage',
  sections JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mountain_mage_curated ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON mountain_mage_curated FOR ALL USING (true) WITH CHECK (true);