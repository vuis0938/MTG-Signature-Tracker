export default function DecksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">核心牌表</h1>
        <p className="text-muted-foreground">管理你的套牌和签绘清单</p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">
          暂无套牌数据，点击上方按钮导入你的第一套牌
        </p>
      </div>
    </div>
  );
}
