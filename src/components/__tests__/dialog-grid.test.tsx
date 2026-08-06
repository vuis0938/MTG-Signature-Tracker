// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ArtistGalleryDialog from "../artist-gallery-dialog";
import VersionSwitchDialog from "@/app/(main)/decks/version-switch-dialog";

// next/image 在 jsdom 里无法直接渲染，mock 为普通 img
vi.mock("next/image", () => ({
  __esModule: true,
  default: function MockImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} />;
  },
}));

// Dialog 内部依赖的 portal 容器
function setupDialogContainer() {
  const container = document.createElement("div");
  container.setAttribute("id", "radix-dialog-root");
  document.body.appendChild(container);
  return () => container.remove();
}

describe("弹窗网格列数", () => {
  it("画廊弹窗使用 4 档响应式网格：2 / 3 / 4 / 5 列", () => {
    const cleanup = setupDialogContainer();

    render(
      <ArtistGalleryDialog
        artist="测试画家"
        cards={[
          {
            name: "测试卡牌",
            set: "set",
            set_name: "测试系列",
            collector_number: "1",
            image_url: "https://example.com/normal/1.jpg",
            released_at: "2024-01-01",
          },
        ]}
        loading={false}
        onClose={() => {}}
      />,
      { container: document.getElementById("radix-dialog-root")! }
    );

    const grid = document.querySelector("[class*='grid-cols-2']");
    expect(grid).toBeTruthy();
    const className = grid!.className;
    expect(className).toContain("grid-cols-2");
    expect(className).toContain("sm:grid-cols-3");
    expect(className).toContain("md:grid-cols-4");
    expect(className).toContain("lg:grid-cols-5");
    expect(className).not.toContain("xl:grid-cols-6");

    cleanup();
  });

  it("切换版本弹窗使用 4 档响应式网格：2 / 3 / 4 / 5 列", () => {
    const cleanup = setupDialogContainer();

    render(
      <VersionSwitchDialog
        switchCard={{
          id: "card-1",
          card_name: "测试卡牌",
          set_code: "set",
          collector_number: "1",
          artist_names: ["画家A"],
          image_url: "https://example.com/normal/1.jpg",
          deck_id: "deck-1",
          status: 0,
          is_signed: false,
        }}
        printings={[
          {
            set: "set",
            set_name: "测试系列",
            collector_number: "1",
            artist: "画家A",
            image_url: "https://example.com/normal/1.jpg",
          },
        ]}
        printingsLoading={false}
        switchPrintingLoading={null}
        deletingCard={null}
        onClose={() => {}}
        onSwitchPrinting={() => {}}
        onDeleteCard={() => {}}
      />,
      { container: document.getElementById("radix-dialog-root")! }
    );

    const grid = document.querySelector("[class*='grid-cols-2']");
    expect(grid).toBeTruthy();
    const className = grid!.className;
    expect(className).toContain("grid-cols-2");
    expect(className).toContain("sm:grid-cols-3");
    expect(className).toContain("md:grid-cols-4");
    expect(className).toContain("lg:grid-cols-5");
    expect(className).not.toContain("xl:grid-cols-6");

    cleanup();
  });
});
