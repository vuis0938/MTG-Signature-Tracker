import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pbkdf2Sync, randomBytes, createHmac } from "crypto";
import {
  hashPassword,
  verifyPassword,
  needsHashUpgrade,
  createToken,
  verifyToken,
  getUserFromRequest,
  isAdmin,
  revokeTokens,
} from "../auth";

// 测试中固定 token_version，避免每次查询结果不同
const TEST_TOKEN_VERSION = "testtokenversion123456";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSupabaseClient: any = {
  from: vi.fn(() => mockSupabaseClient),
  select: vi.fn(() => mockSupabaseClient),
  eq: vi.fn(() => mockSupabaseClient),
  single: vi.fn(() =>
    Promise.resolve({ data: { token_version: TEST_TOKEN_VERSION }, error: null })
  ),
  update: vi.fn(() => mockSupabaseClient),
};

vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => mockSupabaseClient),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("TOKEN_SECRET", "test-secret-must-be-at-least-32-characters-long");
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ═════════════════════════════════════════════════════════════
// hashPassword
// ═════════════════════════════════════════════════════════════

describe("hashPassword", () => {
  it("返回 iterations:salt:hash 格式", async () => {
    const result = await hashPassword("mypassword");
    expect(result).toContain(":");
    const parts = result.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("600000"); // 迭代次数
    expect(parts[1]).toHaveLength(32); // 16 bytes hex = 32 chars
    expect(parts[2]).toHaveLength(128); // 64 bytes hex = 128 chars
  });

  it("每次调用生成不同 salt（非确定性）", async () => {
    const hash1 = await hashPassword("mypassword");
    const hash2 = await hashPassword("mypassword");
    expect(hash1).not.toBe(hash2);
  });

  it("不同密码生成不同哈希", async () => {
    expect(await hashPassword("password1")).not.toBe(await hashPassword("password2"));
  });
});

// ═════════════════════════════════════════════════════════════
// verifyPassword
// ═════════════════════════════════════════════════════════════

describe("verifyPassword", () => {
  it("正确密码返回 true", async () => {
    const stored = await hashPassword("mypassword");
    expect(await verifyPassword("mypassword", stored)).toBe(true);
  });

  it("错误密码返回 false", async () => {
    const stored = await hashPassword("mypassword");
    expect(await verifyPassword("wrongpassword", stored)).toBe(false);
  });

  it("空密码", async () => {
    const stored = await hashPassword("");
    expect(await verifyPassword("", stored)).toBe(true);
    expect(await verifyPassword("notempty", stored)).toBe(false);
  });

  it("兼容旧格式 salt:hash（100,000 次迭代）", async () => {
    // 模拟旧格式哈希：iterations=100000
    const salt = randomBytes(16).toString("hex");
    const hash = pbkdf2Sync("legacytest", salt, 100000, 64, "sha256").toString("hex");
    const legacyStored = `${salt}:${hash}`;
    // 旧格式应能验证成功
    expect(await verifyPassword("legacytest", legacyStored)).toBe(true);
    expect(await verifyPassword("wrong", legacyStored)).toBe(false);
  });

  it("格式错误的存储值返回 false", async () => {
    expect(await verifyPassword("test", "invalidformat")).toBe(false);
    expect(await verifyPassword("test", "")).toBe(false);
    expect(await verifyPassword("test", "onlysalt:")).toBe(false);
  });

  it("哈希值长度不匹配返回 false（防时序攻击异常）", async () => {
    expect(await verifyPassword("test", "abcd:efgh")).toBe(false);
  });

  it("三段格式但迭代次数无效返回 false", async () => {
    expect(await verifyPassword("test", "abc:def:ghi")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// needsHashUpgrade
// ═════════════════════════════════════════════════════════════

describe("needsHashUpgrade", () => {
  it("新格式（600,000 次）不需要升级", async () => {
    const stored = await hashPassword("test");
    expect(needsHashUpgrade(stored)).toBe(false);
  });

  it("旧格式（salt:hash）需要升级", () => {
    const legacyStored = "abcd1234:5678efgh";
    expect(needsHashUpgrade(legacyStored)).toBe(true);
  });

  it("低迭代次数需要升级", () => {
    const lowIterStored = "100000:somesalt:somehash";
    expect(needsHashUpgrade(lowIterStored)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// createToken
// ═════════════════════════════════════════════════════════════

describe("createToken", () => {
  it("返回 payload.signature 格式", async () => {
    const token = await createToken("alice");
    expect(token).toBeTruthy();
    const parts = token!.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it("payload 包含用户名、过期时间和 token_version", async () => {
    const token = await createToken("alice");
    expect(token).toBeTruthy();
    const payload = token!.split(".")[0];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    expect(decoded.u).toBe("alice");
    expect(typeof decoded.e).toBe("number");
    expect(decoded.e).toBeGreaterThan(Date.now());
    expect(decoded.v).toBe(TEST_TOKEN_VERSION);
  });

  it("不同用户名生成不同 token", async () => {
    expect(await createToken("alice")).not.toBe(await createToken("bob"));
  });

  it("支持中文用户名", async () => {
    const token = await createToken("张三");
    const decoded = await verifyToken(token);
    expect(decoded).toBe("张三");
  });

  it("支持特殊字符用户名", async () => {
    const token = await createToken("user.name+tag@example.com");
    expect(await verifyToken(token)).toBe("user.name+tag@example.com");
  });

  it("用户不存在时返回 null", async () => {
    mockSupabaseClient.single.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } });
    expect(await createToken("nonexistent")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// verifyToken
// ═════════════════════════════════════════════════════════════

describe("verifyToken", () => {
  it("有效 token 返回用户名", async () => {
    const token = await createToken("alice");
    expect(await verifyToken(token)).toBe("alice");
  });

  it("undefined 返回 null", async () => {
    expect(await verifyToken(undefined)).toBeNull();
  });

  it("null 返回 null", async () => {
    expect(await verifyToken(null)).toBeNull();
  });

  it("空字符串返回 null", async () => {
    expect(await verifyToken("")).toBeNull();
  });

  it("格式错误（无分隔符）返回 null", async () => {
    expect(await verifyToken("justpayload")).toBeNull();
  });

  it("格式错误（三段）返回 null", async () => {
    expect(await verifyToken("a.b.c")).toBeNull();
  });

  it("篡改签名返回 null", async () => {
    const token = await createToken("alice");
    const [payload] = token!.split(".");
    const forged = `${payload}.invalidSignatureValue`;
    expect(await verifyToken(forged)).toBeNull();
  });

  it("篡改 payload 返回 null（签名不匹配）", async () => {
    const token = await createToken("alice");
    const [, signature] = token!.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ u: "bob", e: Date.now() + 1000000, v: TEST_TOKEN_VERSION })).toString("base64url");
    const forged = `${forgedPayload}.${signature}`;
    expect(await verifyToken(forged)).toBeNull();
  });

  it("完全伪造的 token 返回 null", async () => {
    expect(await verifyToken("fakepayload.fakesignature")).toBeNull();
  });

  it("过期 token 返回 null", async () => {
    const token = await createToken("alice");
    // 解码 payload，修改过期时间为过去，重新编码
    const [payloadStr] = token!.split(".");
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString("utf-8"));
    payload.e = Date.now() - 1000; // 已过期
    // 由于签名会不匹配，需要直接测试 verifyToken 逻辑
    // 创建一个带有效签名但过期时间在过去的 token
    const expiredPayloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
    // 测试环境已通过 beforeEach stub TOKEN_SECRET
    const secret = process.env.TOKEN_SECRET;
    if (!secret) throw new Error("TOKEN_SECRET 未设置");
    const expiredSignature = createHmac("sha256", secret)
      .update(expiredPayloadStr)
      .digest("base64url");
    const expiredToken = `${expiredPayloadStr}.${expiredSignature}`;
    expect(await verifyToken(expiredToken)).toBeNull();
  });

  it("token_version 不匹配返回 null（token 被撤销）", async () => {
    const token = await createToken("alice");
    // 模拟数据库中的 token_version 已变更
    mockSupabaseClient.single.mockResolvedValueOnce({
      data: { token_version: "new-version-after-revoke" },
      error: null,
    });
    expect(await verifyToken(token)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// getUserFromRequest
// ═════════════════════════════════════════════════════════════

describe("getUserFromRequest", () => {
  function makeRequest(cookieValue?: string) {
    return {
      cookies: {
        get: (name: string) =>
          name === "auth_token" && cookieValue !== undefined
            ? { value: cookieValue }
            : undefined,
      },
    };
  }

  it("有效 token 返回用户名", async () => {
    const token = await createToken("alice");
    expect(token).toBeTruthy();
    expect(await getUserFromRequest(makeRequest(token!))).toBe("alice");
  });

  it("无 auth_token cookie 返回 null", async () => {
    expect(await getUserFromRequest(makeRequest(undefined))).toBeNull();
  });

  it("伪造 token 返回 null", async () => {
    expect(await getUserFromRequest(makeRequest("fake.token"))).toBeNull();
  });

  it("空 token 返回 null", async () => {
    expect(await getUserFromRequest(makeRequest(""))).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════
// revokeTokens
// ═════════════════════════════════════════════════════════════

describe("revokeTokens", () => {
  it("成功更新 token_version 返回 true", async () => {
    mockSupabaseClient.update.mockReturnValueOnce({
      eq: vi.fn(() => Promise.resolve({ error: null })),
    });
    expect(await revokeTokens("alice")).toBe(true);
  });

  it("更新失败返回 false", async () => {
    mockSupabaseClient.update.mockReturnValueOnce({
      eq: vi.fn(() => Promise.resolve({ error: { message: "db error" } })),
    });
    expect(await revokeTokens("alice")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// isAdmin
// ═════════════════════════════════════════════════════════════

describe("isAdmin", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_USERS", "alice,bob");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("管理员用户返回 true", () => {
    expect(isAdmin("alice")).toBe(true);
    expect(isAdmin("bob")).toBe(true);
  });

  it("非管理员用户返回 false", () => {
    expect(isAdmin("charlie")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isAdmin("Alice")).toBe(true);
    expect(isAdmin("BOB")).toBe(true);
  });

  it("未配置 ADMIN_USERS 返回 false", () => {
    vi.stubEnv("ADMIN_USERS", "");
    expect(isAdmin("alice")).toBe(false);
  });
});
