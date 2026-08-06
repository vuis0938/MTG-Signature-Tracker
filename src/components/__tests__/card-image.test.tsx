// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CardImage } from "../card-image";

// ═════════════════════════════════════════════════════════════
// CardImage 组件测试
//
// 覆盖正常渲染、small 尺寸 URL 替换、加载失败降级。
// next/image 在 jsdom 中无法直接运行，因此 mock 为可控的 img。
// ═════════════════════════════════════════════════════════════

vi.mock("next/image", () => ({
  __esModule: true,
  default: function MockImage({
    src,
    alt,
    onError,
    className,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
    className?: string;
  }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} onError={onError} data-testid="next-image" />;
  },
}));

describe("CardImage", () => {
  it("渲染 normal 尺寸图片", () => {
    const { getByTestId } = render(
      <CardImage src="https://example.com/normal/card.jpg" alt="测试卡牌" />
    );

    const img = getByTestId("next-image");
    expect(img.getAttribute("src")).toBe("https://example.com/normal/card.jpg");
    expect(img.getAttribute("alt")).toBe("测试卡牌");
  });

  it("size='small' 将 URL 中的 /normal/ 替换为 /small/", () => {
    const { getByTestId } = render(
      <CardImage
        src="https://example.com/normal/card.jpg"
        alt="测试卡牌"
        size="small"
      />
    );

    const img = getByTestId("next-image");
    expect(img.getAttribute("src")).toBe("https://example.com/small/card.jpg");
  });

  it("加载失败时降级为普通 img 标签", () => {
    const { getByTestId, container } = render(
      <CardImage src="https://example.com/normal/card.jpg" alt="测试卡牌" />
    );

    const nextImg = getByTestId("next-image");
    fireEvent.error(nextImg);

    // 降级后的 img 不再有 data-testid="next-image"
    expect(container.querySelector('[data-testid="next-image"]')).toBeNull();
    const fallbackImg = container.querySelector("img");
    expect(fallbackImg).toBeTruthy();
    expect(fallbackImg?.getAttribute("src")).toBe("https://example.com/normal/card.jpg");
    expect(fallbackImg?.getAttribute("alt")).toBe("测试卡牌");
  });

  it("包裹层保持 5:7 比例占位", () => {
    const { container } = render(
      <CardImage src="https://example.com/normal/card.jpg" alt="测试卡牌" />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("aspect-[5/7]");
    expect(wrapper.className).toContain("relative");
  });
});
