import { describe, it, expect } from "vitest";
import {
  splitArtists,
  extractArtists,
  extractImageUrl,
  type ScryfallCard,
} from "../scryfall-client";

// ═════════════════════════════════════════════════════════════
// splitArtists
// ═════════════════════════════════════════════════════════════

describe("splitArtists", () => {
  it("单个画家", () => {
    expect(splitArtists("John Avon")).toEqual(["John Avon"]);
  });

  it("& 分隔合作画师", () => {
    expect(splitArtists("John Avon & Kev Walker")).toEqual([
      "John Avon",
      "Kev Walker",
    ]);
  });

  it("and 分隔合作画师", () => {
    expect(splitArtists("Mark Tedin and John Avon")).toEqual([
      "Mark Tedin",
      "John Avon",
    ]);
  });

  it("逗号分隔合作画师", () => {
    expect(splitArtists("Alayna Danner, John Avon")).toEqual([
      "Alayna Danner",
      "John Avon",
    ]);
  });

  it("混合分隔符", () => {
    expect(splitArtists("Alice & Bob and Charlie, Dan")).toEqual([
      "Alice",
      "Bob",
      "Charlie",
      "Dan",
    ]);
  });

  it("空字符串返回 Unknown Artist", () => {
    expect(splitArtists("")).toEqual(["Unknown Artist"]);
  });

  it("null 返回 Unknown Artist", () => {
    expect(splitArtists(null as unknown as string)).toEqual(["Unknown Artist"]);
  });

  it("去除首尾空格", () => {
    expect(splitArtists("  John Avon  ")).toEqual(["John Avon"]);
  });

  it("去除每段空格", () => {
    expect(splitArtists("  Alice  &  Bob  ")).toEqual(["Alice", "Bob"]);
  });

  it("多个 & 分隔", () => {
    expect(splitArtists("Alice & Bob & Charlie")).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("过滤空段", () => {
    expect(splitArtists("Alice &  & Bob")).toEqual(["Alice", "Bob"]);
  });
});

// ═════════════════════════════════════════════════════════════
// extractArtists
// ═════════════════════════════════════════════════════════════

describe("extractArtists", () => {
  function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
    return {
      id: "test-id",
      name: "Test Card",
      set_name: "Test Set",
      set: "TST",
      collector_number: "1",
      artist: "John Avon",
      ...overrides,
    };
  }

  it("普通卡牌 — 返回正面画家", () => {
    expect(extractArtists(makeCard({ artist: "John Avon" }))).toEqual([
      "John Avon",
    ]);
  });

  it("合作画师 — 拆分多个画家", () => {
    expect(
      extractArtists(makeCard({ artist: "John Avon & Kev Walker" }))
    ).toEqual(["John Avon", "Kev Walker"]);
  });

  it("双面牌 — 合并正反面画家（去重）", () => {
    const card = makeCard({
      artist: "John Avon",
      card_faces: [
        { artist: "John Avon", image_uris: undefined },
        { artist: "Kev Walker", image_uris: undefined },
      ],
    });
    expect(extractArtists(card)).toEqual(["John Avon", "Kev Walker"]);
  });

  it("双面牌 — 正反面同一画家去重", () => {
    const card = makeCard({
      artist: "John Avon",
      card_faces: [{ artist: "John Avon" }],
    });
    expect(extractArtists(card)).toEqual(["John Avon"]);
  });

  it("无 artist 字段返回 Unknown Artist", () => {
    expect(extractArtists(makeCard({ artist: "" }))).toEqual([
      "Unknown Artist",
    ]);
  });

  it("无 artist 且有 card_faces — 从 face 提取", () => {
    const card = makeCard({
      artist: "",
      card_faces: [{ artist: "Kev Walker" }],
    });
    expect(extractArtists(card)).toEqual(["Kev Walker"]);
  });

  it("完全无画家信息返回 Unknown Artist", () => {
    const card = makeCard({
      artist: "",
      card_faces: [{ artist: "" }],
    });
    expect(extractArtists(card)).toEqual(["Unknown Artist"]);
  });
});

// ═════════════════════════════════════════════════════════════
// extractImageUrl
// ═════════════════════════════════════════════════════════════

describe("extractImageUrl", () => {
  function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
    return {
      id: "test-id",
      name: "Test Card",
      set_name: "Test Set",
      set: "TST",
      collector_number: "1",
      artist: "Test Artist",
      ...overrides,
    };
  }

  it("优先返回 normal 图片", () => {
    const card = makeCard({
      image_uris: {
        normal: "https://example.com/normal.jpg",
        small: "https://example.com/small.jpg",
        png: "https://example.com/png.png",
      },
    });
    expect(extractImageUrl(card)).toBe("https://example.com/normal.jpg");
  });

  it("无 normal 时降级到 png", () => {
    const card = makeCard({
      image_uris: {
        normal: "",
        small: "https://example.com/small.jpg",
        png: "https://example.com/png.png",
      },
    });
    // normal 为空字符串（falsy），降级到 png
    expect(extractImageUrl(card)).toBe("https://example.com/png.png");
  });

  it("无 image_uris 时从 card_faces 提取", () => {
    const card = makeCard({
      image_uris: undefined,
      card_faces: [
        {
          artist: "Test",
          image_uris: {
            normal: "https://example.com/face-normal.jpg",
            small: "https://example.com/face-small.jpg",
            png: "https://example.com/face-png.png",
          },
        },
      ],
    });
    expect(extractImageUrl(card)).toBe("https://example.com/face-normal.jpg");
  });

  it("完全无图片返回 null", () => {
    const card = makeCard({
      image_uris: undefined,
      card_faces: undefined,
    });
    expect(extractImageUrl(card)).toBeNull();
  });

  it("image_uris 为空对象返回 null", () => {
    const card = makeCard({
      image_uris: undefined,
    });
    expect(extractImageUrl(card)).toBeNull();
  });
});
