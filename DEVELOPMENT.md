# 开发规范

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

- Next.js 15 (App Router)
- Supabase (PostgreSQL + RLS)
- Vercel (部署)
- Vitest (测试)

## 关键文件

- 认证: `src/lib/auth.ts` (Node) / `src/lib/auth-edge.ts` (Edge)
- 中间件: `src/middleware.ts`
- 匹配逻辑: `src/lib/match-utils.ts`
- 限流: `src/lib/rate-limit.ts`