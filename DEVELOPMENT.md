# 开发规范

## 项目简介

MTG 签绘管家 — 万智牌签绘收藏管理工具。核心功能：导入牌表、匹配活动画家、管理签绘进度。

## 分支策略

| 分支 | 用途 | 规则 |
|------|------|------|
| `main` | 线上生产环境，Vercel 自动部署 | **禁止直接推送**，只通过 PR 合入 |
| `dev` | 日常开发分支 | 所有新功能、Bug 修复都在此分支开发 |

## 工作流程

```
dev 上开发 → git push → Vercel 预览环境验证 → 确认无误 → 合并到 main 上线
```

## 合并到 main 前检查清单

- [ ] `npx vitest run` 全部通过
- [ ] `npx tsc --noEmit` 零错误
- [ ] 预览环境手动验证核心流程（登录、匹配、状态切换）
- [ ] 数据库变更向后兼容（只加不删，不改名）

## 技术栈

- Next.js 15 (App Router) + TypeScript
- Supabase (PostgreSQL + RLS)
- shadcn/ui + Tailwind CSS
- Vercel (部署)
- Vitest (测试)

## 关键文件

- 认证: `src/lib/auth.ts` (Node) / `src/lib/auth-edge.ts` (Edge)
- 中间件: `src/middleware.ts`
- 匹配逻辑: `src/lib/match-utils.ts`
- 限流: `src/lib/rate-limit.ts`
- Supabase 客户端: `src/lib/supabase.ts`

## 已踩过的坑（不要重蹈覆辙）

### 1. `safeNormalize` 不可替换为原生 `normalize()`

`src/lib/match-utils.ts` 中的 `safeNormalize` 函数存在是因为 UC 浏览器 ICU 实现不完整，调用 `String.normalize("NFD")` 会直接抛异常。**绝对不要**改用原生 `normalize`，否则 UC 用户匹配功能会崩溃。

### 2. Edge Runtime 和 Node Runtime 的认证函数不能混用

`src/lib/auth.ts` 用 Node `crypto`，用于 API 路由。`src/lib/auth-edge.ts` 用 Web Crypto API，用于 middleware。两者 token 格式完全一致，但混用会导致运行时崩溃。