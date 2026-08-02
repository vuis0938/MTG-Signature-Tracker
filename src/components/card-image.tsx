"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * 卡牌图片组件
 *
 * 基于 next/image，提供自动格式转换（AVIF/WebP）、
 * 响应式尺寸（sizes 让浏览器按实际展示宽度下载最小可用图）、
 * 防布局抖动（CLS，aspect-[5/7] 占位）。
 *
 * MTG 卡牌标准比例 5:7（约 488x680）。
 */

// 覆盖两类展示场景：结果网格（移动端 3 列 ≈ 33vw）
// 与弹窗画廊（移动端 2 列 ≈ 50vw），取较大估值避免视网膜屏模糊
const DEFAULT_SIZES =
  "(max-width: 640px) 45vw, (max-width: 768px) 30vw, (max-width: 1024px) 22vw, 17vw";

export function CardImage({
  src,
  alt,
  className,
  sizes = DEFAULT_SIZES,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
}) {
  const [errored, setErrored] = useState(false);

  // next/image 优化失败时，降级为普通 img 标签直接加载原图
  if (errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className}
        loading="lazy"
      />
    );
  }

  return (
    <span
      className={"block relative aspect-[5/7] overflow-hidden " + (className ?? "")}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
        loading="lazy"
        placeholder="empty"
        onError={() => setErrored(true)}
      />
    </span>
  );
}
