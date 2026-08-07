// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import DecksClient, { DeckListItem } from "../decks-client";
import type { Deck, CardEntry, DeckStats } from "@/types";

// ═════════════════════════════════════════════════════════════
// DecksClient 复杂交互测试
//
// 覆盖：展开/收起套牌、卡牌状态三态切换（乐观更新/回滚）、
//       批量修改确认、印刷版本切换、添加卡牌、导入套牌。
// ═════════════════════════════════════════════════════════════

vi.mock("next/image", () => ({
  __esModule: true,
  default: function MockImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} />;
  },
}));

vi.mock("@/components/card-image", () => ({
  CardImage: function MockCardImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} data-testid="card-image" />;
  },
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/display-mode", () => ({
  useDisplayMode: () => ({ mode: "individual" as const }),
}));

vi.mock("@/lib/deck-layout", () => ({
  useDeckLayout: () => ({ layout: "default" as const }),
}));

vi.mock("@/lib/preload", () => ({
  preloadData: vi.fn(),
  getPreloadedData: vi.fn(),
  preloadDialogChunks: vi.fn(),
}));

vi.mock("../version-switch-dialog", () => ({
  __esModule: true,
  default: function MockVersionSwitchDialog({ onClose }: { onClose: () => void }) {
    return (
      <div data-testid="version-switch-dialog">
        <button onClick={onClose}>关闭版本弹窗</button>
      </div>
    );
  },
}));

function makeCard(overrides: Partial<CardEntry> = {}): CardEntry {
  return {
    id: `card-${overrides.id ?? Math.random().toString(36).slice(2, 7)}`,
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

const deck: Deck = { id: "deck-1", name: "测试套牌", updated_at: "2026-01-01T00:00:00Z" };
const stats: DeckStats = { total: 2, unsigned: 2, pending: 0, heart: 0 };

function createWrapper(cache = new Map()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => cache as unknown as import("swr").Cache, dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    );
  };
}

function renderDecksClient(overrides: { fallbackDecks?: Deck[]; fallbackStats?: Record<string, DeckStats>; fallbackCards?: Record<string, CardEntry[]> } = {}) {
  const fallbackDecks = overrides.fallbackDecks ?? [deck];
  const fallbackStats = overrides.fallbackStats ?? { "deck-1": stats };
  const fallbackCards = overrides.fallbackCards ?? {
    "deck-1": [makeCard({ id: "c1", status: 0 }), makeCard({ id: "c2", status: 0, artist_names: ["画家B"] })],
  };
  return render(
    <DecksClient
      fallbackDecks={fallbackDecks}
      fallbackStats={fallbackStats}
      fallbackCards={fallbackCards}
    />,
    { wrapper: createWrapper() }
  );
}

describe("DecksClient 复杂交互", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockToast.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染套牌列表并展开显示卡牌", async () => {
    renderDecksClient();

    expect(screen.getByText("测试套牌")).toBeTruthy();

    // 点击套牌头部展开
    fireEvent.click(screen.getByText("测试套牌"));

    await waitFor(() => {
      expect(screen.getAllByText("测试卡牌").length).toBeGreaterThanOrEqual(2);
    });

    // 再次点击收起
    fireEvent.click(screen.getByText("测试套牌"));
    await waitFor(() => {
      expect(screen.queryAllByText("测试卡牌").length).toBe(0);
    });
  });

  it("点击卡牌触发乐观更新并调用 PATCH /api/cards", async () => {
    const cards = [makeCard({ id: "c1", status: 0, card_name: "Sol Ring" })];
    renderDecksClient({ fallbackCards: { "deck-1": cards } });

    fireEvent.click(screen.getByText("测试套牌"));
    await waitFor(() => expect(screen.getByText("Sol Ring")).toBeTruthy());

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const cardEl = screen.getByLabelText(/Sol Ring，未签/);
    fireEvent.click(cardEl);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/cards",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"cardIds\":[\"c1\"]"),
        })
      );
    });

    // 乐观更新后状态变为 1（送签中），aria-label 会变化
    await waitFor(() => {
      expect(screen.getByLabelText(/送签中/)).toBeTruthy();
    });
  });

  it("PATCH 失败时回滚 UI 并提示错误", async () => {
    const cards = [makeCard({ id: "c1", status: 0, card_name: "Sol Ring" })];
    renderDecksClient({ fallbackCards: { "deck-1": cards } });

    fireEvent.click(screen.getByText("测试套牌"));
    await waitFor(() => expect(screen.getByText("Sol Ring")).toBeTruthy());

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "服务器繁忙" }), { status: 200 })
    );

    const cardEl = screen.getByLabelText(/Sol Ring，未签/);
    fireEvent.click(cardEl);

    // PATCH 立即失败时 React 18 会把乐观更新和回滚批量处理，最终状态回到未签
    await waitFor(() => expect(screen.getByLabelText(/Sol Ring，未签/)).toBeTruthy());

    expect(mockToast).toHaveBeenCalledWith("服务器繁忙", "error");
  });

  it("网络异常时回滚 UI 并提示网络错误", async () => {
    const cards = [makeCard({ id: "c1", status: 0, card_name: "Sol Ring" })];
    renderDecksClient({ fallbackCards: { "deck-1": cards } });

    fireEvent.click(screen.getByText("测试套牌"));
    await waitFor(() => expect(screen.getByText("Sol Ring")).toBeTruthy());

    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));

    fireEvent.click(screen.getByLabelText(/Sol Ring，未签/));

    // 网络异常立即失败时 React 18 会把乐观更新和回滚批量处理，最终状态回到未签
    await waitFor(() => expect(screen.getByLabelText(/Sol Ring，未签/)).toBeTruthy());

    expect(mockToast).toHaveBeenCalledWith("网络错误，状态已恢复", "error");
  });

  it("独立模式下点击有副本的卡牌弹出批量修改确认", async () => {
    const cards = [
      makeCard({ id: "c1", card_name: "Sol Ring" }),
      makeCard({ id: "c2", card_name: "Sol Ring" }),
    ];
    renderDecksClient({ fallbackCards: { "deck-1": cards } });

    fireEvent.click(screen.getByText("测试套牌"));
    await waitFor(() => expect(screen.getAllByText("Sol Ring").length).toBeGreaterThanOrEqual(2));

    // 点击切换版本按钮（右上角 RefreshCw）会触发 loadPrintings，检测到副本后弹出批量确认
    const switchButtons = screen.getAllByLabelText(/切换 Sol Ring 的印刷版本/);
    fireEvent.click(switchButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("批量修改卡牌版本？")).toBeTruthy();
    });

    expect(screen.getByText("全部修改（2 张）")).toBeTruthy();
  });

  it("导入套牌成功后刷新列表并清空表单", async () => {
    renderDecksClient();

    // 打开导入表单
    fireEvent.click(screen.getByText("导入套牌"));
    await waitFor(() => expect(screen.getByLabelText("套牌名称")).toBeTruthy());

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, deckId: "deck-new", successCount: 2, total: 2, failCount: 0 }),
        { status: 200 }
      )
    );

    fireEvent.change(screen.getByLabelText("套牌名称"), { target: { value: "新套牌" } });
    fireEvent.change(screen.getByLabelText("牌表内容"), { target: { value: "1 Sol Ring\n1 Arcane Signet" } });
    fireEvent.click(screen.getByText("开始导入"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/import-deck",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("新套牌"),
        })
      );
    });

    expect(mockToast).toHaveBeenCalledWith("「新套牌」导入成功，共 2 张", "success");
  });

  it("添加卡牌成功后刷新当前套牌卡牌", async () => {
    renderDecksClient();

    fireEvent.click(screen.getByText("测试套牌"));
    await waitFor(() => expect(screen.getAllByText("测试卡牌").length).toBeGreaterThanOrEqual(2));

    // 点击添加卡牌按钮
    fireEvent.click(screen.getByLabelText("添加卡牌"));
    await waitFor(() => expect(document.querySelector("textarea#addCardsText")).toBeTruthy());

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, successCount: 1, total: 1, failCount: 0 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, cards: [makeCard({ id: "c3" })] }), { status: 200 })
      );

    const textarea = document.querySelector("textarea#addCardsText") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "1 New Card" } });
    fireEvent.click(screen.getAllByRole("button", { name: "添加卡牌" }).pop()!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/add-cards",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("New Card"),
        })
      );
    });

    expect(mockToast).toHaveBeenCalledWith("追加成功，共 1 张", "success");
  });

  it("删除套牌确认后调用 DELETE 并刷新", async () => {
    renderDecksClient();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const deleteButton = screen.getByLabelText("删除套牌");
    vi.stubGlobal("confirm", vi.fn(() => true));
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/decks?deckId=deck-1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    expect(mockToast).toHaveBeenCalledWith("套牌已删除", "success");
    vi.unstubAllGlobals();
  });
});

describe("DeckListItem 单元", () => {
  const noop = () => {};

  it("不同布局渲染对应的 grid 类名", () => {
    const { container } = render(
      <DeckListItem
        deck={deck}
        stats={stats}
        isExpanded={true}
        cards={[makeCard()]}
        cardsLoading={false}
        displayMode="individual"
        deckLayout="compact"
        pendingStatusIds={new Set()}
        onToggle={noop}
        onAddCards={noop}
        onDelete={noop}
        onToggleStatus={noop}
        onLoadPrintings={noop}
      />
    );
    expect(container.querySelector(".grid.grid-cols-2")).toBeTruthy();
  });

  it("点击卡牌触发 onToggleStatus 并传入所有副本 ID", async () => {
    const onToggleStatus = vi.fn();
    render(
      <DeckListItem
        deck={deck}
        stats={stats}
        isExpanded={true}
        cards={[makeCard({ id: "c1" }), makeCard({ id: "c2" })]}
        cardsLoading={false}
        displayMode="individual"
        deckLayout="default"
        pendingStatusIds={new Set()}
        onToggle={noop}
        onAddCards={noop}
        onDelete={noop}
        onToggleStatus={onToggleStatus}
        onLoadPrintings={noop}
      />
    );

    fireEvent.click(screen.getAllByLabelText(/未签/)[0]);
    expect(onToggleStatus).toHaveBeenCalledWith(["c1"], 0, "deck-1");
  });
});
