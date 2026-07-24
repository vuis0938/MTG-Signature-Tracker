/**
 * 从 cookie 读取当前用户名
 */
export function getCurrentUser(): string {
  if (typeof document === "undefined") return "默认用户";
  const match = document.cookie.match(/(?:^|;\s*)user_name=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "默认用户";
}
