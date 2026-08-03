-- ════════════════════════════════════════════════════════════
-- 画家卡牌持久缓存表
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 作用：将 Scryfall 查询结果持久化到数据库，避免每次部署后
--   首次查询画家卡牌都要等待 Scryfall 响应（300-1000ms）
--   二次查询同一画家时直接返回缓存（~50ms）
--
-- 注意：如果未执行此 SQL，API 会自动降级为内存缓存 + Scryfall 查询，
--   功能不受影响，只是部署后首次查询会稍慢
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS artist_cards (
  artist_name TEXT PRIMARY KEY,
  cards JSONB NOT NULL,
  card_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按画家名查询的索引（主键已覆盖，此处显式声明）
CREATE INDEX IF NOT EXISTS idx_artist_cards_name ON artist_cards (artist_name);

-- 自动更新 updated_at
-- 使用 $BODY$ 替代 $$ 作为美元引用分隔符，避免 Supabase SQL Editor 解析问题
CREATE OR REPLACE FUNCTION update_artist_cards_timestamp()
RETURNS TRIGGER AS $BODY$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artist_cards_updated ON artist_cards;
CREATE TRIGGER trg_artist_cards_updated
  BEFORE UPDATE ON artist_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_artist_cards_timestamp();
