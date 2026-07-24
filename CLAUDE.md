# MTG 签绘管家 — AI 开发指引

## 项目文档

在写任何代码前，请先阅读以下标准文件：

| 文件 | 内容 | 何时查阅 |
|------|------|---------|
| [docs/requirements.md](./docs/requirements.md) | 项目需求、功能列表、页面规划 | 不确定功能范围时 |
| [docs/tech-stack.md](./docs/tech-stack.md) | 技术栈选型、API 说明、依赖列表 | 添加新依赖或调外部 API 时 |
| [docs/design-spec.md](./docs/design-spec.md) | 配色、版式、组件规范 | 写 UI 代码前 |
| [docs/roadmap.md](./docs/roadmap.md) | 5 个阶段的开发路线图 | 规划下一阶段任务时 |
| [docs/conventions.md](./docs/conventions.md) | 编码规范、Git 纪律、文件组织 | 写任何代码时遵守 |

## 项目计划

完整的项目前期计划：`.claude/plans/gemini-swirling-bonbon.md`（在项目外）

## 开发日志

每日开发记录在 [dev-logs/](./dev-logs/) 文件夹中。
每个工作日结束时更新当天的日志文件（格式: `YYYY-MM-DD.md`）。

## 工作流程

1. **开始工作前**: 查阅 `docs/roadmap.md` 确认当前阶段
2. **写代码时**: 遵守 `docs/conventions.md` 中的规范
3. **完成一个阶段**: Git commit，更新 `docs/roadmap.md` 打勾
4. **每天结束**: 更新 `dev-logs/` 中当天的日志

## 开发纪律

- 每完成一个阶段的任务，立即 `git commit`
- 小步迭代，每个功能点写完验证再继续
- Scryfall API: 100ms 间隔 + 自定义 User-Agent
- CSV 解析: 强依赖 Set Code + Collector Number
- 所有异步操作要有 Loading 状态，所有错误要有 Toast 提示
