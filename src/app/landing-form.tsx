"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";

type Mode = "login" | "register" | "forgot";

/**
 * 落地页内嵌认证表单
 *
 * 支持三种模式：登录 / 注册 / 忘记密码
 * 通过 URL query param (?mode=register / ?mode=forgot) 切换，
 * 也可通过内部按钮切换。
 */
export function LandingForm({ initialMode = "login" }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState<string>("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotQuestion, setForgotQuestion] = useState("");
  const router = useRouter();

  const usernameRef = useRef<HTMLInputElement>(null);
  const forgotUsernameRef = useRef<HTMLInputElement>(null);
  const forgotAnswerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "login" || mode === "register") {
      usernameRef.current?.focus();
    } else if (mode === "forgot") {
      if (forgotStep === 1) {
        forgotUsernameRef.current?.focus();
      } else if (forgotStep === 2) {
        forgotAnswerRef.current?.focus();
      }
    }
  }, [mode, forgotStep]);

  function switchMode(newMode: Mode) {
    setMode(newMode);
    setError("");
    setSuccess("");
    setConfirmPassword("");
    setSecurityAnswer("");
    setForgotStep(1);

    // 同步 URL，方便刷新后保持模式
    const url = new URL(window.location.href);
    if (newMode === "login") {
      url.searchParams.delete("mode");
    } else {
      url.searchParams.set("mode", newMode);
    }
    window.history.replaceState({}, "", url.toString());
  }

  // ─── 登录 / 注册 ───
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);

    try {
      const body: Record<string, string> = { username: username.trim(), password };

      if (mode === "register") {
        body.securityQuestion = securityQuestion;
        body.securityAnswer = securityAnswer;
      }

      const res = await fetch("/api/auth", {
        method: mode === "register" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push("/decks");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "操作失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  // ─── 忘记密码：获取安全问题 ───
  async function handleFetchQuestion(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/forgot-password?username=${encodeURIComponent(username.trim())}`);
      const data = await res.json();
      if (data.success) {
        setForgotQuestion(data.question);
        setForgotStep(2);
      } else {
        setError(data.error || "操作失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  // ─── 忘记密码：验证答案 + 重置密码 ───
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          securityAnswer,
          newPassword: password,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess("密码重置成功，请重新登录");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setSecurityAnswer("");
        setForgotStep(1);
      } else {
        setError(data.error || "操作失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* 成功提示 */}
      {success && (
        <p className="text-sm text-green-600 mb-4 text-center">{success}</p>
      )}

      {/* ─── 登录 / 注册 ─── */}
      {(mode === "login" || mode === "register") && (
        <>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                ref={usernameRef}
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {mode === "register" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">确认密码</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="请再次输入密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securityQuestion">安全问题</Label>
                  <select
                    id="securityQuestion"
                    value={securityQuestion}
                    onChange={(e) => setSecurityQuestion(e.target.value)}
                    className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base md:text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 appearance-none cursor-pointer bg-no-repeat pr-8"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
                      backgroundPosition: "right 0.5rem center",
                      backgroundSize: "1rem",
                    }}
                    required
                  >
                    <option value="" disabled>凭此问题找回密码</option>
                    {SECURITY_QUESTIONS.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="securityAnswer">安全问题答案</Label>
                  <Input
                    id="securityAnswer"
                    placeholder="请输入答案"
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                    required
                  />
                </div>
              </>
            )}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? (mode === "register" ? "注册中..." : "登录中...")
                : mode === "register" ? "注册并登录" : "登录"}
            </Button>
          </form>
          <div className="flex items-center justify-between mt-4">
            <Button
              variant="link"
              size="sm"
              onClick={() => switchMode(mode === "register" ? "login" : "register")}
            >
              {mode === "register" ? "已有账号？去登录" : "没有账号？注册"}
            </Button>
            {mode === "login" && (
              <Button
                variant="link"
                size="sm"
                onClick={() => switchMode("forgot")}
              >
                忘记密码？
              </Button>
            )}
          </div>
        </>
      )}

      {/* ─── 忘记密码 ─── */}
      {mode === "forgot" && (
        <>
          {forgotStep === 1 && (
            <form onSubmit={handleFetchQuestion} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-username">用户名</Label>
                <Input
                  id="forgot-username"
                  ref={forgotUsernameRef}
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "查询中..." : "下一步"}
              </Button>
            </form>
          )}
          {forgotStep === 2 && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label>安全问题</Label>
                <p className="text-sm font-medium p-3 rounded-md bg-muted">
                  {forgotQuestion}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-answer">答案</Label>
                <Input
                  id="forgot-answer"
                  ref={forgotAnswerRef}
                  placeholder="请输入答案"
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-password">新密码</Label>
                <Input
                  id="forgot-password"
                  type="password"
                  placeholder="至少 8 个字符"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-confirm">确认新密码</Label>
                <Input
                  id="forgot-confirm"
                  type="password"
                  placeholder="请再次输入新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "重置中..." : "重置密码"}
              </Button>
            </form>
          )}
          <Button
            variant="link"
            size="sm"
            className="mt-4 w-full"
            onClick={() => switchMode("login")}
          >
            <ArrowLeft className="h-3 w-3 mr-1" />
            返回登录
          </Button>
        </>
      )}
    </>
  );
}
