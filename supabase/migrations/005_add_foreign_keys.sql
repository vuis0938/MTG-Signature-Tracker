-- ════════════════════════════════════════════════════════════
-- 添加外键约束
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 背景：
--   cards 表的 deck_id 列在数据库层面没有外键约束指向 decks 表。
--   这导致 PostgREST（Supabase 的 API 层）无法解析 cards→decks 的 join，
--   如 .select("id, deck:decks!inner(user_name)") 会报错。
--
--   虽然应用代码已改为两步查询避免 join，但添加外键约束仍是最佳实践：
--   - 保证数据完整性（删除套牌时自动级联删除卡牌）
--   - 让 PostgREST 能正确解析关系（未来可用 join 语法）
--   - 帮助查询优化器生成更好的执行计划
-- ════════════════════════════════════════════════════════════

-- ─── 1. 清理孤立的卡牌（deck_id 指向不存在的套牌）────────
-- 添加外键前必须清理违反引用完整性的数据，否则 ADD CONSTRAINT 会失败
DELETE FROM cards
WHERE deck_id NOT IN (SELECT id FROM decks);

-- ─── 2. 添加外键约束 ──────────────────────────────────
-- ON DELETE CASCADE: 删除套牌时自动删除其下所有卡牌
-- （与应用层 deleteDeck 逻辑一致，避免孤儿数据）
DO $$
BEGIN
  -- 检查约束是否已存在，避免重复创建报错
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cards_deck_id'
  ) THEN
    ALTER TABLE cards
      ADD CONSTRAINT fk_cards_deck_id
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '添加外键约束失败（可能已存在）: %', SQLERRM;
END $$;

-- ════════════════════════════════════════════════════════════
-- 说明：
--   执行此 SQL 后，PostgREST 的 schema cache 会自动更新（通常几分钟内）。
--   如需立即生效，可在 Supabase Dashboard 执行：
--   NOTIFY pgrst, 'reload schema';
-- ════════════════════════════════════════════════════════════
