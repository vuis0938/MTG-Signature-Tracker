# 设计规范

## 设计原则
- 极简干净，信息层级清晰
- 响应式设计：PC 端侧边栏导航，移动端底部 Tab Bar
- 行动引导清晰：每个操作有明确的视觉反馈
- 移动端优先：卡片网格在手机上要足够大，方便查看卡图

## 配色方案

| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| background | #ffffff | #0a0a0a | 主背景 |
| foreground | #171717 | #ededed | 主文字 |
| primary | #2563eb (blue-600) | #3b82f6 (blue-500) | 主色调，按钮、强调 |
| muted | #f4f4f5 (zinc-100) | #27272a (zinc-800) | 次级背景 |
| muted-foreground | #71717a | #a1a1aa | 次级文字 |
| success | #16a34a (green-600) | #22c55e (green-500) | 已签标记 |
| border | #e4e4e7 | #3f3f46 | 边框线 |

## 版式

- 使用 Geist 字体（Next.js 默认）
- 标题: font-semibold
- 正文: 默认 weight
- 卡牌名称: font-medium, text-sm

## 组件规范

### 卡牌图片卡片
- 圆角: rounded-lg 或 rounded-xl
- 阴影: shadow-sm，悬浮时 shadow-md
- 已签状态: opacity-50 + 绿色边框 + ✅ 图标
- 未签状态: 正常显示

### 画家分组
- 画家名: 大号字体 + 🎨 emoji + 卡牌数量
- 卡牌网格: flex-wrap, gap-4
- 来源套牌标签: 小号 muted 颜色

### 按钮
- 主操作: bg-primary text-white rounded-lg
- 次级操作: border 描边样式
- 危险操作: 红色警告
