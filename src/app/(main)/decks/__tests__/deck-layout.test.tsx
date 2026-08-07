// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { DeckListItem } from "../decks-client";
import type { CardEntry, Deck, DeckStats } from "@/types";

vi.mock("next/image", () => ({
  __esModule: true,
  default: function MockImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} />;
  },
}));

function makeCard(overrides: Partial<CardEntry> = {}): CardEntry {
  return {
    id: `card-${overrides.id ?? Math.random().toString(36).slice(2)}`,
    deck_id: "deck-1",
    card_name: "测试卡牌",
    set_code: "set",
    collector_number: "1",
    artist_names: ["画家A"],
    image_url: "https://example.com/normal/1.jpg",
    status: 0,
    ...overrides,
  };
}

const deck: Deck = { id: "deck-1", name: "测试套牌" };
const stats: DeckStats = { total: 2, unsigned: 2, pending: 0, heart: 0 };
const noop = () => {};

function renderDeckListItem(layout: "default" | "compact" | "list") {
  return render(
    <DeckListItem
      deck={deck}
      stats={stats}
      isExpanded={true}
      cards={[makeCard({ artist_names: ["画家A"] }), makeCard({ artist_names: ["画家B"] })]}
      cardsLoading={false}
      displayMode="individual"
      deckLayout={layout}
      onToggle={noop}
      onAddCards={noop}
      onDelete={noop}
      onToggleStatus={noop}
      onLoadPrintings={noop}
    />
  );
}

describe("套牌页面布局", () => {
  it("紧凑模式：外层 2/3 列画家，内层 2/4 列卡牌", () => {
    const { container } = renderDeckListItem("compact");
    const outerGrid = container.querySelector(".grid.grid-cols-2");
    expect(outerGrid).toBeTruthy();
    expect(outerGrid!.className).toContain("grid-cols-2");
    expect(outerGrid!.className).toContain("lg:grid-cols-3");

    const innerGrid = container.querySelector(".grid.grid-cols-2.sm\\:grid-cols-4");
    expect(innerGrid).toBeTruthy();
    expect(innerGrid!.className).toContain("grid-cols-2");
    expect(innerGrid!.className).toContain("sm:grid-cols-4");
  });

  it("默认模式：单列画家，卡牌 4/5/6/7 列", () => {
    const { container } = renderDeckListItem("default");
    const cardGrid = container.querySelector(".grid.grid-cols-4");
    expect(cardGrid).toBeTruthy();
    expect(cardGrid!.className).toContain("grid-cols-4");
    expect(cardGrid!.className).toContain("md:grid-cols-5");
    expect(cardGrid!.className).toContain("lg:grid-cols-6");
    expect(cardGrid!.className).toContain("xl:grid-cols-7");
  });

  it("文本模式：画家列数 1/2/3，与紧凑模式外层断点一致", () => {
    const { container } = renderDeckListItem("list");
    const outerGrid = container.querySelector(".grid.grid-cols-1");
    expect(outerGrid).toBeTruthy();
    expect(outerGrid!.className).toContain("grid-cols-1");
    expect(outerGrid!.className).toContain("sm:grid-cols-2");
    expect(outerGrid!.className).toContain("lg:grid-cols-3");
  });
});
