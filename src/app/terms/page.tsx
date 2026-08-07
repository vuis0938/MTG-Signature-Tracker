import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";

export const metadata: Metadata = {
  title: "用户协议",
  description: "使用 MTG 签绘管家服务前，请仔细阅读本用户协议。",
  openGraph: {
    description: "使用 MTG 签绘管家服务前，请仔细阅读本用户协议。",
  },
};

export default function TermsPage() {
  return (
    <div className="container max-w-3xl mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">用户协议</CardTitle>
          <CardDescription>最后更新日期：2026 年 8 月 6 日</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">1. 服务说明</h2>
            <p className="text-muted-foreground">
              MTG 签绘管家（以下简称“本服务”）是一款面向万智牌玩家的签绘收藏管理工具，
              提供套牌导入、画家匹配、签绘状态追踪、活动信息展示等功能。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">2. 账号注册与安全</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>您需要注册账号才能使用本服务。</li>
              <li>您应对账号和密码保密，因保管不善导致的损失由您自行承担。</li>
              <li>禁止注册或使用与他人混淆、违法违规的用户名。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">3. 用户行为规范</h2>
            <p>使用本服务时，您同意不会：</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>利用自动化脚本、爬虫或其他技术手段对本服务进行未授权访问。</li>
              <li>试图绕过安全机制、破解系统或干扰服务正常运行。</li>
              <li>上传或传播违法、侵权、骚扰、欺诈等内容。</li>
              <li>滥用反馈、错误上报等功能发送垃圾信息。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">4. 数据与知识产权</h2>
            <p className="text-muted-foreground">
              您导入的套牌与签绘数据归您所有。卡牌图片、系列信息、画家资料等来源于
              Scryfall 等第三方公开数据，其知识产权归 respective 权利人所有。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">5. 免责声明</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>本服务按“现状”提供，不保证服务永远 uninterrupted 或完全没有错误。</li>
              <li>活动画家信息来自第三方公开来源，可能存在滞后或误差，请以官方信息为准。</li>
              <li>因网络、第三方服务故障或不可抗力导致的数据丢失，我们不承担责任，但会尽力恢复。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">6. 服务变更与终止</h2>
            <p className="text-muted-foreground">
              我们有权根据运营需要调整、暂停或终止部分或全部服务。如服务发生重大变更，
              我们将尽量提前通知用户。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">7. 协议更新</h2>
            <p className="text-muted-foreground">
              我们可能会不时更新本协议。更新后的协议将在本页面发布，继续使用本服务即视为您同意更新后的协议。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">8. 联系我们</h2>
            <p className="text-muted-foreground">
              如有任何问题，请通过应用内“设置 → 反馈与建议”联系我们。
            </p>
          </section>
        </CardContent>
      </Card>
      <BackButton className="w-full mt-6" />
    </div>
  );
}
