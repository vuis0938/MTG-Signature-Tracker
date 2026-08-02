"use client";

import Image from "next/image";

/**
 * 卡牌图片组件
 *
 * 基于 next/image，提供自动格式转换（AVIF/WebP）、
 * 响应式尺寸、防布局抖动（CLS）和模糊占位。
 *
 * MTG 卡牌标准比例 5:7（约 488x680）。
 */

const CARD_WIDTH = 400;
const CARD_HEIGHT = 560;

export function CardImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      className={className}
      loading="lazy"
      // 卡牌图较多，用低质量占位避免大量模糊计算
      placeholder="empty"
    />
  );
}
