-- ════════════════════════════════════════════════════════════
-- 给 decks 表添加 updated_at 列
-- ════════════════════════════════════════════════════════════
-- 
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 背景：
--   decks 表创建时漏掉了 updated_at 列，导致：
--   1. /api/decks 接口查询失败（select 了不存在的列）
--   2. touchDeck() 更新套牌时间静默失败
--   3. 套牌页面刷新后"上次更新"时间回退到 created_at
-- ════════════════════════════════════════════════════════════

-- 添加 updated_at 列（如果不存在）
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'decks' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE decks ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- 对于已有行，updated_at 设置为 created_at（避免 NULL）
UPDATE decks SET updated_at = created_at WHERE updated_at IS NULL;