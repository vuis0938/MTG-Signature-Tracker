export default function MatchPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">活动匹配</h1>
        <p className="text-muted-foreground">粘贴活动画家名单，匹配你需要签绘的卡牌</p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">
          请先导入套牌数据，然后在此粘贴活动名单进行匹配
        </p>
      </div>
    </div>
  );
}
