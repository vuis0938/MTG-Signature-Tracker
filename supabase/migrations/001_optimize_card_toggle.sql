-- ════════════════════════════════════════════════════════════
-- 卡牌状态切换性能优化
-- ════════════════════════════════════════════════════════════
--
-- 执行位置：Supabase Dashboard → SQL Editor → 粘贴执行
--
-- 优化内容：
--   1. 创建 RPC 函数 update_card_with_ownership
--      将原先的两次 DB 查询（SELECT 归属校验 + UPDATE）合并为单次
--   2. 添加索引加速 JOIN 查询
-- ════════════════════════════════════════════════════════════

-- ─── 1. 性能索引 ──────────────────────────────────────────

-- cards.deck_id 索引：加速 cards → decks 的 JOIN（归属校验）
-- PostgreSQL 外键不会自动创建索引，必须手动添加
CREATE INDEX IF NOT EXISTS idx_cards_deck_id ON cards (deck_id);

-- decks.user_name 索引：加速按用户名查询套牌
CREATE INDEX IF NOT EXISTS idx_decks_user_name ON decks (user_name);

-- cards.id 已有主键索引，无需额外创建

-- ─── 2. RPC 函数：原子化卡牌状态更新 ──────────────────────

-- 将 SELECT（归属校验）+ UPDATE 两次 DB 往返合并为单次
-- 服务端通过 Service Role Key 调用，绕过 RLS
CREATE OR REPLACE FUNCTION update_card_with_ownership(
  p_card_id UUID,
  p_user_name TEXT,
  p_status INT,
  p_is_signed BOOLEAN,
  p_event_name TEXT,
  p_event_date TEXT
) RETURNS TABLE(success BOOLEAN, error TEXT) AS $$
DECLARE
  v_updated INT;
  v_exists INT;
BEGIN
  -- 单条 UPDATE 同时完成归属校验和数据更新
  -- WHERE 子句中的子查询确保只有卡牌属于该用户时才会更新
  UPDATE cards SET
    status = p_status,
    is_signed = p_is_signed,
    event_name = p_event_name,
    event_date = p_event_date
  WHERE cards.id = p_card_id
    AND cards.deck_id IN (SELECT id FROM decks WHERE user_name = p_user_name);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;
  ELSE
    -- 区分"卡牌不存在"和"无权操作"
    SELECT COUNT(*) INTO v_exists FROM cards WHERE id = p_card_id;
    IF v_exists > 0 THEN
      RETURN QUERY SELECT FALSE, '无权操作此卡牌'::TEXT;
    ELSE
      RETURN QUERY SELECT FALSE, '卡牌不存在'::TEXT;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════════════════════════
-- 说明：
--   执行此 SQL 后，API 路由 /api/cards PATCH 会自动使用 RPC 函数。
--   如果未执行此 SQL，API 会自动降级为原来的两次查询方式，功能不受影响。
-- ════════════════════════════════════════════════════════════
