-- ════════════════════════════════════════════════════════════
-- Scryfall 数据版本号表
-- ════════════════════════════════════════════════════════════
--
-- 存储 Scryfall bulk-data 的 updated_at 时间戳。
-- 这是 Scryfall 官方的"数据版本号"——只要它没变，
-- 世界上没有任何卡牌数据发生变化（新系列、SLD、勘误等）。
--
-- 用于判断 card_printings 缓存是否绝对可靠。
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scryfall_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 插入初始记录
INSERT INTO scryfall_meta (key, value)
VALUES ('bulk_data_version', '{"updated_at": null}')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE scryfall_meta ENABLE ROW LEVEL SECURITY;

-- 所有人可读（版本号是公共信息）
CREATE POLICY "所有人可读 scryfall 元数据" ON scryfall_meta
  FOR SELECT USING (true);

-- 禁止前端直接写入（只能通过 API 服务端写入）
CREATE POLICY "禁止前端写入 scryfall 元数据" ON scryfall_meta
  FOR INSERT WITH CHECK (false);

CREATE POLICY "禁止前端修改 scryfall 元数据" ON scryfall_meta
  FOR UPDATE USING (false);