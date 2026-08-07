/**
 * 边缘运行时兼容的认证工具
 *
 * Next.js Middleware 在 Edge Runtime 中执行，无法使用 Node.js 的 `crypto` 模块。
 * 本模块使用 Web Crypto API 实现 token 验证，与 src/lib/auth.ts 保持相同格式。
 */

// 生产环境必须设置 TOKEN_SECRET，否则运行时报错
// 开发环境使用默认值方便本地调试
let _tokenSecret: string | null = null;
function getTokenSecret(): string {
  if (_tokenSecret !== null) return _tokenSecret;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "生产环境必须设置 TOKEN_SECRET 环境变量（建议 32+ 字符随机字符串）"
      );
    }
    _tokenSecret = "mtg-dev-secret-change-in-production";
  } else {
    _tokenSecret = secret;
  }
  return _tokenSecret;
}

// Token 有效期：7 天（与 auth.ts 保持一致）
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TokenPayload {
  u: string; // username
  e: number; // expiry timestamp (ms)
}

function base64UrlToBase64(input: string): string {
  let padded = input.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) {
    padded += "=";
  }
  return padded;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const base64 = base64UrlToBase64(input);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * 生成签名 token（HMAC-SHA256）
 *
 * 边缘运行时版本，与 auth.ts 的 createToken 输出格式完全一致。
 * 注意：由于 Web Crypto 是异步 API，此函数为 async。
 */
export async function createToken(username: string): Promise<string> {
  const payload: TokenPayload = {
    u: username,
    e: Date.now() + TOKEN_TTL_MS,
  };
  const payloadStr = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const key = await importHmacKey(getTokenSecret());
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadStr)
  );
  const signature = base64UrlEncode(new Uint8Array(signatureBytes));
  return `${payloadStr}.${signature}`;
}

/**
 * 验证 token 并返回 username（无效或过期则返回 null）
 *
 * 边缘运行时版本，使用 Web Crypto API 校验 HMAC-SHA256 签名。
 */
export async function verifyToken(
  token: string | undefined | null
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) return null;

  try {
    const key = await importHmacKey(getTokenSecret());
    const expectedBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payloadStr)
    );
    const expectedSignature = base64UrlEncode(new Uint8Array(expectedBytes));

    // 常数时间比较，防止时序攻击
    const sigBytes = base64UrlDecode(signature);
    const expectedBytesArr = base64UrlDecode(expectedSignature);
    if (sigBytes.length !== expectedBytesArr.length) return null;
    let diff = 0;
    for (let i = 0; i < sigBytes.length; i++) {
      diff |= sigBytes[i] ^ expectedBytesArr[i];
    }
    if (diff !== 0) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadStr))
    ) as TokenPayload;
    if (typeof payload.e !== "number" || Date.now() > payload.e) {
      return null;
    }
    return payload.u;
  } catch {
    return null;
  }
}

/** 从 NextRequest 的 cookie 中提取已验证的用户名 */
export async function getUserFromRequest(request: {
  cookies: { get: (name: string) => { value: string } | undefined };
}): Promise<string | null> {
  const token = request.cookies.get("auth_token")?.value;
  return verifyToken(token);
}

/**
 * 检查用户是否为管理员
 *
 * 与 auth.ts 保持相同逻辑；环境变量在 Edge Runtime 中同样可用。
 */
let _adminSet: Set<string> | null | undefined;

export function isAdmin(userName: string): boolean {
  // 测试环境 env 会被动态 stub，跳过缓存
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    const adminUsers = process.env.ADMIN_USERS;
    if (!adminUsers) return false;
    return adminUsers
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .includes(userName.trim().toLowerCase());
  }

  if (_adminSet === undefined) {
    const adminUsers = process.env.ADMIN_USERS;
    _adminSet = adminUsers
      ? new Set(adminUsers.split(",").map((u) => u.trim().toLowerCase()))
      : null;
  }
  return _adminSet !== null && _adminSet.has(userName.trim().toLowerCase());
}
