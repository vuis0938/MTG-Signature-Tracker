/**
 * 安全问题列表（客户端和服务端共用）
 *
 * 从 auth.ts 拆出，因为 auth.ts 含 server-only 限制。
 * 修改此列表时需同步 auth.ts 中的 SECURITY_QUESTIONS。
 */
export const SECURITY_QUESTIONS = [
  "你最珍贵的签绘卡是哪张？",
  "你第一次参加的万智牌赛事叫什么？",
  "你的第一副万智牌套牌叫什么？",
  "你最想获得签绘的卡牌是哪张？",
  "你的宠物叫什么名字？",
  "你最喜欢的电影是什么？",
] as const;
