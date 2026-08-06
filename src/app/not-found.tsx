import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home } from "lucide-react";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-4xl font-bold">404</CardTitle>
          <CardDescription>页面找不到了</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            您访问的页面可能已被删除、移动，或者从未存在过。
          </p>
          <Link href="/decks" className="w-full">
            <Button className="w-full">
              <Home className="h-4 w-4 mr-2" />
              返回首页
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
