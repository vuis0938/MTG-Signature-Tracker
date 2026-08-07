"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Palette, ArrowLeft } from "lucide-react";
import { SECURITY_QUESTIONS } from "@/lib/security-questions";

type Mode = "login" | "register" | "forgot" | "setup";
type SetupReason = "plaintext_password" | "missing_security_question" | null;

/** 轻量错误上报（不阻塞流程） */
function reportClientError(message: string, context?: Record<string, unknown>) {
  try {
    fetch("/api/error-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        url: typeof window !== "undefined" ? window.location.href : "",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        ...context,
      }),
    }).catch(() => {});
  } catch {
    // 上报失败静默处理
  }
}

/** 显眼的错误提示条（确保用户在各种浏览器都能看到红色提示） */
function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">{message}</p>
    </div>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState<string>("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1=输入用户名, 2=回答问题+新密码
  const [forgotQuestion, setForgotQuestion] = useState("");
  const [setupReason, setSetupReason] = useState<SetupReason>(null);
  const router = useRouter();

  const usernameRef = useRef<HTMLInputElement>(null);
  const forgotUsernameRef = useRef<HTMLInputElement>(null);
  const forgotAnswerRef = useRef<HTMLInputElement>(null);

  // 在客户端 hydration 完成后聚焦输入框，避免 SSR 时 autoFocus 造成 DOM 不一致
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
    setCurrentPassword("");
    setSetupReason(null);
    setForgotStep(1);
  }

  // ─── 登录 / 注册 ───
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("请输入用户名");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
      if (password.length < 8) {
        setError("密码至少 8 个字符");
        return;
      }
      if (!securityQuestion) {
        setError("请选择一个安全问题");
        return;
      }
      if (!securityAnswer.trim()) {
        setError("请输入安全问题答案");
        return;
      }
    }

    setLoading(true);

    try {
      const body: Record<string, string> = { username: trimmedUsername, password };

      if (mode === "register") {
        body.securityQuestion = securityQuestion;
        body.securityAnswer = securityAnswer;
      }

      reportClientError("[login] 提交登录/注册", { mode, username: trimmedUsername });

      const res = await fetch("/api/auth", {
        method: mode === "register" ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Pragma": "no-cache",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      // 防御 UC 等浏览器省流/云端加速把 JSON 响应篡改为 HTML
      const contentType = res.headers.get("content-type") || "";
      const responseText = await res.text();
      const isHtmlResponse = responseText.trim().startsWith("<");
      if (!contentType.includes("application/json") || isHtmlResponse) {
        reportClientError("[login] 登录响应被拦截或格式异常", {
          status: res.status,
          contentType,
          bodyPreview: responseText.slice(0, 500),
        });
        setError(isHtmlResponse
          ? "浏览器省流模式干扰了登录，请关闭 UC 极速/云端加速后重试"
          : "登录响应异常，请重试");
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch (parseErr: unknown) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        reportClientError("[login] 登录响应 JSON 解析失败", { error: parseMsg, bodyPreview: responseText.slice(0, 500) });
        setError("登录响应解析失败，请重试");
        return;
      }

      if (res.ok) {
        if (data.needsSetup) {
          setSetupReason(data.setupReason as SetupReason);
          setCurrentPassword(password);
          setPassword("");
          setConfirmPassword("");
          setSecurityQuestion("");
          setSecurityAnswer("");
          setMode("setup");
        } else if (data.success) {
          router.push("/decks");
          router.refresh();
        } else {
          reportClientError("[login] 登录响应异常", { response: JSON.stringify(data) });
          setError(typeof data.error === "string" ? data.error : "登录失败，请重试");
        }
      } else {
        const errMsg = typeof data.error === "string" ? data.error : `登录失败（${res.status}）`;
        reportClientError("[login] 登录请求失败", { status: res.status, error: errMsg });
        setError(errMsg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportClientError("[login] 登录异常", { error: msg });
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  // ─── 完善账号：补充安全问题 / 升级明文密码 ───
  async function handleSetupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("请输入用户名");
      return;
    }
    if (!currentPassword) {
      setError("请输入当前密码");
      return;
    }

    if (setupReason === "plaintext_password") {
      if (password !== confirmPassword) {
        setError("两次输入的新密码不一致");
        return;
      }
      if (password.length < 8) {
        setError("新密码至少 8 个字符");
        return;
      }
    }

    if (!securityQuestion) {
      setError("请选择一个安全问题");
      return;
    }
    if (!securityAnswer.trim()) {
      setError("请输入安全问题答案");
      return;
    }

    setLoading(true);

    try {
      const body: Record<string, string> = {
        username: trimmedUsername,
        currentPassword,
        securityQuestion,
        securityAnswer,
      };
      if (setupReason === "plaintext_password") {
        body.newPassword = password;
      }

      reportClientError("[login] 提交完善账号", { setupReason, username: trimmedUsername });

      const res = await fetch("/api/auth", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Pragma": "no-cache",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      // 防御 UC 等浏览器省流/云端加速把 JSON 响应篡改为 HTML
      const contentType = res.headers.get("content-type") || "";
      const responseText = await res.text();
      const isHtmlResponse = responseText.trim().startsWith("<");
      if (!contentType.includes("application/json") || isHtmlResponse) {
        reportClientError("[login] 完善账号响应被拦截或格式异常", {
          status: res.status,
          contentType,
          bodyPreview: responseText.slice(0, 500),
        });
        setError(isHtmlResponse
          ? "浏览器省流模式干扰了请求，请关闭 UC 极速/云端加速后重试"
          : "完善账号响应异常，请重试");
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch (parseErr: unknown) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        reportClientError("[login] 完善账号响应 JSON 解析失败", { error: parseMsg, bodyPreview: responseText.slice(0, 500) });
        setError("完善账号响应解析失败，请重试");
        return;
      }

      if (res.ok) {
        if (data.success) {
          router.push("/decks");
          router.refresh();
        } else {
          reportClientError("[login] 完善账号响应异常", { response: JSON.stringify(data) });
          setError(typeof data.error === "string" ? data.error : "完善账号失败，请重试");
        }
      } else {
        const errMsg = typeof data.error === "string" ? data.error : `完善账号失败（${res.status}）`;
        reportClientError("[login] 完善账号请求失败", { status: res.status, error: errMsg });
        setError(errMsg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportClientError("[login] 完善账号异常", { error: msg });
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  // ─── 忘记密码：获取安全问题 ───
  async function handleFetchQuestion(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("请输入用户名");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/forgot-password?username=${encodeURIComponent(trimmedUsername)}&_t=${Date.now()}`, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Pragma": "no-cache",
        },
        cache: "no-store",
      });
      const text = await res.text();
      if (text.trim().startsWith("<")) {
        reportClientError("[login] 找回密码响应被拦截", { bodyPreview: text.slice(0, 500) });
        setError("浏览器省流模式干扰了请求，请关闭 UC 极速/云端加速后重试");
        return;
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        setError("服务器响应异常，请重试");
        return;
      }
      if (data.success) {
        setForgotQuestion(String(data.question || ""));
        setForgotStep(2);
      } else {
        setError(typeof data.error === "string" ? data.error : "操作失败");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportClientError("[login] 找回密码请求异常", { error: msg });
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  // ─── 忘记密码：验证答案 + 重置密码 ───
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("请输入用户名");
      return;
    }
    if (!securityAnswer.trim()) {
      setError("请输入安全问题答案");
      return;
    }
    if (!password) {
      setError("请输入新密码");
      return;
    }
    if (password.length < 8) {
      setError("新密码至少 8 个字符");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Pragma": "no-cache",
        },
        body: JSON.stringify({
          username: trimmedUsername,
          securityAnswer,
          newPassword: password,
        }),
        cache: "no-store",
      });

      const text = await res.text();
      if (text.trim().startsWith("<")) {
        reportClientError("[login] 重置密码响应被拦截", { bodyPreview: text.slice(0, 500) });
        setError("浏览器省流模式干扰了请求，请关闭 UC 极速/云端加速后重试");
        return;
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        setError("服务器响应异常，请重试");
        return;
      }
      if (data.success) {
        setSuccess(typeof data.message === "string" ? data.message : "密码已重置，请使用新密码登录");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setSecurityAnswer("");
        setForgotStep(1);
      } else {
        setError(typeof data.error === "string" ? data.error : "操作失败");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reportClientError("[login] 重置密码请求异常", { error: msg });
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm" suppressHydrationWarning>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl flex items-center justify-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            MTG 签绘管家
          </CardTitle>
          <CardDescription>
            {mode === "login" && "请输入用户名和密码"}
            {mode === "register" && "注册新账号"}
            {mode === "forgot" && "找回密码"}
            {mode === "setup" && "完善账号安全信息"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 成功提示 */}
          {success && (
            <p className="text-sm text-green-600 mb-4 text-center">{success}</p>
          )}

          {/* 顶部错误提示（确保任何模式下都可见） */}
          {error && <div className="mb-4"><ErrorAlert message={error} /></div>}

          {/* ─── 登录 / 注册 ─── */}
          {(mode === "login" || mode === "register") && (
            <>
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                <form onSubmit={handleFetchQuestion} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-username">用户名</Label>
                    <Input
                      id="forgot-username"
                      ref={forgotUsernameRef}
                      placeholder="请输入用户名"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "查询中..." : "下一步"}
                  </Button>
                </form>
              )}
              {forgotStep === 2 && (
                <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
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
                    />
                  </div>
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

          {/* ─── 完善账号 ─── */}
          {mode === "setup" && (
            <>
              <form onSubmit={handleSetupSubmit} className="space-y-4" noValidate>
                <p className="text-sm text-muted-foreground">
                  {setupReason === "plaintext_password"
                    ? "检测到账号密码仍为明文存储，需要设置新密码和安全问题。"
                    : "账号缺少安全问题，补充后即可正常使用。"}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="setup-current-password">当前密码</Label>
                  <Input
                    id="setup-current-password"
                    type="password"
                    placeholder="请输入当前密码"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                {setupReason === "plaintext_password" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="setup-password">新密码</Label>
                      <Input
                        id="setup-password"
                        type="password"
                        placeholder="至少 8 个字符"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="setup-confirm">确认新密码</Label>
                      <Input
                        id="setup-confirm"
                        type="password"
                        placeholder="请再次输入新密码"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="setup-security-question">安全问题</Label>
                  <select
                    id="setup-security-question"
                    value={securityQuestion}
                    onChange={(e) => setSecurityQuestion(e.target.value)}
                    className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base md:text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 appearance-none cursor-pointer bg-no-repeat pr-8"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
                      backgroundPosition: "right 0.5rem center",
                      backgroundSize: "1rem",
                    }}
                  >
                    <option value="" disabled>凭此问题找回密码</option>
                    {SECURITY_QUESTIONS.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-security-answer">安全问题答案</Label>
                  <Input
                    id="setup-security-answer"
                    placeholder="请输入答案"
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "保存中..." : "保存并登录"}
                </Button>
              </form>
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

          {/* 协议链接 */}
          <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground">
            登录或注册即表示您同意
            <Link href="/terms" className="underline hover:text-foreground mx-1">
              用户协议
            </Link>
            和
            <Link href="/privacy" className="underline hover:text-foreground mx-1">
              隐私政策
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
