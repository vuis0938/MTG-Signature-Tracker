import { describe, it, expect } from "vitest";
import { groupCardsByArtist, mergeIdenticalCards } from "../decks-client";
import type { CardEntry } from "@/types";

// ═════════════════════════════════════════════════════════════
// 套牌数据分组 / 合并逻辑测试
//
// 这些纯函数支撑套牌页的展示：按画家分组后，相同卡牌合并显示。
// ═════════════════════════════════════════════════════════════

function makeCard(overrides: Partial<CardEntry> = {}): CardEntry {
  return {
    id: `card-${Math.random().toString(36).slice(2, 7)}`,
    deck_id: "deck-1",
    card_name: "Sol Ring",
    set_code: "cmd",
    collector_number: "1",
    artist_names: ["Artist A"],
    image_url: "https://example.com/card.jpg",
    status: 0,
    ...overrides,
  };
}

describe("groupCardsByArtist", () => {
  it("按画家将卡牌分组", () => {
    const cards = [
      makeCard({ card_name: "Card 1", artist_names: ["Alice"] }),
      makeCard({ card_name: "Card 2", artist_names: ["Bob"] }),
      makeCard({ card_name: "Card 3", artist_names: ["Alice"] }),
    ];

    const groups = groupCardsByArtist(cards);

    expect(groups.get("Alice")).toHaveLength(2);
    expect(groups.get("Bob")).toHaveLength(1);
    expect(groups.get("Alice")?.map((c) => c.card_name)).toContain("Card 1");
    expect(groups.get("Alice")?.map((c) => c.card_name)).toContain("Card 3");
  });

  it("多画家卡牌会出现在多个分组中", () => {
    const cards = [makeCard({ card_name: "Dual", artist_names: ["Alice", "Bob"] })];

    const groups = groupCardsByArtist(cards);

    expect(groups.get("Alice")).toHaveLength(1);
    expect(groups.get("Bob")).toHaveLength(1);
    expect(groups.get("Alice")?.[0].card_name).toBe("Dual");
    expect(groups.get("Bob")?.[0].card_name).toBe("Dual");
  });

  it("空数组返回空 Map", () => {
    expect(groupCardsByArtist([]).size).toBe(0);
  });
});

describe("mergeIdenticalCards", () => {
  it("合并同名同系列同编号同状态的卡牌", () => {
    const cards = [
      makeCard({ id: "a1", card_name: "Sol Ring", set_code: "cmd", collector_number: "1", status: 0 }),
      makeCard({ id: "a2", card_name: "Sol Ring", set_code: "cmd", collector_number: "1", status: 0 }),
      makeCard({ id: "b1", card_name: "Arcane Signet", set_code: "cmd", collector_number: "2", status: 0 }),
    ];

    const merged = mergeIdenticalCards(cards);

    expect(merged).toHaveLength(2);
    const solRing = merged.find((g) => g.card.card_name === "Sol Ring");
    expect(solRing?.count).toBe(2);
    expect(solRing?.ids).toContain("a1");
    expect(solRing?.ids).toContain("a2");
  });

  it("不同状态的同款卡牌不合并", () => {
    const cards = [
      makeCard({ id: "a1", card_name: "Sol Ring", status: 0 }),
      makeCard({ id: "a2", card_name: "Sol Ring", status: 1 }),
    ];

    const merged = mergeIdenticalCards(cards);

    expect(merged).toHaveLength(2);
    expect(merged.every((g) => g.count === 1)).toBe(true);
  });

  it("不同系列或编号的卡牌不合并", () => {
    const cards = [
      makeCard({ id: "a1", card_name: "Sol Ring", set_code: "cmd", collector_number: "1" }),
      makeCard({ id: "a2", card_name: "Sol Ring", set_code: "sld", collector_number: "1494" }),
    ];

    const merged = mergeIdenticalCards(cards);

    expect(merged).toHaveLength(2);
  });

  it("单张卡牌返回 count = 1", () => {
    const cards = [makeCard({ id: "only", card_name: "Sol Ring" })];

    const merged = mergeIdenticalCards(cards);

    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(1);
    expect(merged[0].ids).toEqual(["only"]);
  });

  it("空数组返回空数组", () => {
    expect(mergeIdenticalCards([])).toEqual([]);
  });
});
