/**
 * 安全问题列表（客户端和服务端共用）
 *
 * 从 auth.ts 拆出，因为 auth.ts 含 server-only 限制。
 * 修改此列表时需同步 auth.ts 中的 SECURITY_QUESTIONS。
 */
export const SECURITY_QUESTIONS = [
  "您入坑时的万智牌系列是？",
  "您的第一套指挥官主将是？",
  "您最喜欢的万智牌画家是？",
  "您最喜欢的万智牌时空是？",
  "您最喜欢的拉尼卡公会是？",
  "您最常光顾的线下牌店是？",
] as const;
