import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "了解 MTG 签绘管家如何收集、使用和保护您的个人信息。",
};

export default function PrivacyPage() {
  return (
    <div className="container max-w-3xl mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">隐私政策</CardTitle>
          <CardDescription>最后更新日期：2026 年 8 月 6 日</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">1. 我们收集哪些信息</h2>
            <p>
              为提供签绘管理服务，我们可能会收集以下信息：
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>账户信息：用户名、密码（以加密形式存储）。</li>
              <li>套牌与卡牌数据：您导入的套牌名称、卡牌名称、系列代码、画家信息、签绘状态等。</li>
              <li>安全信息：您设置的安全问题及答案（用于找回密码）。</li>
              <li>使用信息：您主动提交的反馈、Bug 报告或功能建议。</li>
              <li>技术信息：浏览器类型、访问时间、IP 地址（用于限流与安全防护）。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">2. 我们如何使用您的信息</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>为您提供套牌导入、画家匹配、签绘状态追踪等核心功能。</li>
              <li>保障账户安全，防止未授权访问。</li>
              <li>处理您的反馈并改进产品。</li>
              <li>在必要时用于排查技术问题。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">3. 数据存储与安全</h2>
            <p className="text-muted-foreground">
              您的数据存储在 Supabase 提供的数据库服务中。我们采用行级安全策略（RLS）
              和 Service Role Key 服务端访问机制，尽量确保每位用户只能访问自己的数据。
              密码使用 PBKDF2-SHA256 算法进行哈希处理，不会以明文形式存储。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">4. 数据共享与披露</h2>
            <p className="text-muted-foreground">
              我们不会将您的个人数据出售给第三方。仅在以下情形可能披露数据：
              法律法规要求、保护我们的合法权益、或在您明确同意的情况下。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">5. 您的权利</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>您可以在设置页导出或删除自己的全部数据。</li>
              <li>您可以通过反馈入口联系我们，要求更正或删除账户信息。</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">6. Cookie 与本地存储</h2>
            <p className="text-muted-foreground">
              我们使用 httpOnly Cookie 存储登录凭证，并使用 localStorage
              保存您的显示偏好（如卡牌显示模式、套牌布局）。这些偏好信息不会上传到服务器。
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">7. 联系我们</h2>
            <p className="text-muted-foreground">
              如果您对隐私政策有任何疑问，请通过应用内“设置 → 反馈与建议”联系我们。
            </p>
          </section>
        </CardContent>
      </Card>
      <BackButton className="w-full mt-6" />
    </div>
  );
}
