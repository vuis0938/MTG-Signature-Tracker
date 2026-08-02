import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getUserFromRequest,
} from "../auth";

// ═════════════════════════════════════════════════════════════
// hashPassword
// ═════════════════════════════════════════════════════════════

describe("hashPassword", () => {
  it("返回 salt:hash 格式", () => {
    const result = hashPassword("mypassword");
    expect(result).toContain(":");
    const [salt, hash] = result.split(":");
    expect(salt).toHaveLength(32); // 16 bytes hex = 32 chars
    expect(hash).toHaveLength(128); // 64 bytes hex = 128 chars
  });

  it("每次调用生成不同 salt（非确定性）", () => {
    const hash1 = hashPassword("mypassword");
    const hash2 = hashPassword("mypassword");
    expect(hash1).not.toBe(hash2);
  });

  it("不同密码生成不同哈希", () => {
    expect(hashPassword("password1")).not.toBe(hashPassword("password2"));
  });
});

// ═════════════════════════════════════════════════════════════
// verifyPassword
// ═════════════════════════════════════════════════════════════

describe("verifyPassword", () => {
  it("正确密码返回 true", () => {
    const stored = hashPassword("mypassword");
    expect(verifyPassword("mypassword", stored)).toBe(true);
  });

  it("错误密码返回 false", () => {
    const stored = hashPassword("mypassword");
    expect(verifyPassword("wrongpassword", stored)).toBe(false);
  });

  it("空密码", () => {
    const stored = hashPassword("");
    expect(verifyPassword("", stored)).toBe(true);
    expect(verifyPassword("notempty", stored)).toBe(false);
  });

  it("格式错误的存储值返回 false", () => {
    expect(verifyPassword("test", "invalidformat")).toBe(false);
    expect(verifyPassword("test", "")).toBe(false);
    expect(verifyPassword("test", "onlysalt:")).toBe(false);
  });

  it("哈希值长度不匹配返回 false（防时序攻击异常）", () => {
    expect(verifyPassword("test", "abcd:efgh")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// createToken
// ═════════════════════════════════════════════════════════════

describe("createToken", () => {
  it("返回 payload.signature 格式", () => {
    const token = createToken("alice");
    expect(token).toContain(".");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it("payload 包含用户名和过期时间", () => {
    const token = createToken("alice");
    const payload = token.split(".")[0];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    expect(decoded.u).toBe("alice");
    expect(typeof decoded.e).toBe("number");
    expect(decoded.e).toBeGreaterThan(Date.now());
  });

  it("不同用户名生成不同 token", () => {
    expect(createToken("alice")).not.toBe(createToken("bob"));
  });

  it("支持中文用户名", () => {
    const token = createToken("张三");
    const decoded = verifyToken(token);
    expect(decoded).toBe("张三");
  });

  it("支持特殊字符用户名", () => {
    const token = createToken("user.name+tag@example.com");
    expect(verifyToken(token)).toBe("user.name+tag@example.com");
  });
});

// ═════════════════════════════════════════════════════════════
// verifyToken
// ═════════════════════════════════════════════════════════════

describe("verifyToken", () => {
  it("有效 token 返回用户名", () => {
    const token = createToken("alice");
    expect(verifyToken(token)).toBe("alice");
  });

  it("undefined 返回 null", () => {
    expect(verifyToken(undefined)).toBeNull();
  });

  it("null 返回 null", () => {
    expect(verifyToken(null)).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(verifyToken("")).toBeNull();
  });

  it("格式错误（无分隔符）返回 null", () => {
    expect(verifyToken("justpayload")).toBeNull();
  });

  it("格式错误（三段）返回 null", () => {
    expect(verifyToken("a.b.c")).toBeNull();
  });

  it("篡改签名返回 null", () => {
    const token = createToken("alice");
    const [payload] = token.split(".");
    const forged = `${payload}.invalidSignatureValue`;
    expect(verifyToken(forged)).toBeNull();
  });

  it("篡改 payload 返回 null（签名不匹配）", () => {
    const token = createToken("alice");
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ u: "bob", e: Date.now() + 1000000 })).toString("base64url");
    const forged = `${forgedPayload}.${signature}`;
    expect(verifyToken(forged)).toBeNull();
  });

  it("完全伪造的 token 返回 null", () => {
    expect(verifyToken("fakepayload.fakesignature")).toBeNull();
  });

  it("过期 token 返回 null", () => {
    const token = createToken("alice");
    // 解码 payload，修改过期时间为过去，重新编码
    const [payloadStr, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString("utf-8"));
    payload.e = Date.now() - 1000; // 已过期
    // 由于签名会不匹配，需要直接测试 verifyToken 逻辑
    // 创建一个带有效签名但过期时间在过去的 token
    const expiredPayloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const { createHmac } = require("crypto");
    // TOKEN_SECRET 在开发环境有默认值
    const expiredSignature = createHmac("sha256", "mtg-dev-secret-change-in-production")
      .update(expiredPayloadStr)
      .digest("base64url");
    const expiredToken = `${expiredPayloadStr}.${expiredSignature}`;
    expect(verifyToken(expiredToken)).toBeNull();
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

  it("有效 token 返回用户名", () => {
    const token = createToken("alice");
    expect(getUserFromRequest(makeRequest(token))).toBe("alice");
  });

  it("无 auth_token cookie 返回 null", () => {
    expect(getUserFromRequest(makeRequest(undefined))).toBeNull();
  });

  it("伪造 token 返回 null", () => {
    expect(getUserFromRequest(makeRequest("fake.token"))).toBeNull();
  });

  it("空 token 返回 null", () => {
    expect(getUserFromRequest(makeRequest(""))).toBeNull();
  });
});
