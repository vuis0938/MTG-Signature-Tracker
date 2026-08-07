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
 *
 * size 属性：数据库统一存 normal 尺寸 URL，
 * 弹窗场景传 size="small" 自动转换为 small 尺寸（146×204），
 * 减少弹窗内大量图片的传输量。
 */

// 覆盖两类展示场景：结果网格（移动端 3 列 ≈ 33vw）
// 与弹窗画廊（移动端 2 列 ≈ 50vw），取较大估值避免视网膜屏模糊
const DEFAULT_SIZES =
  "(max-width: 640px) 45vw, (max-width: 768px) 30vw, (max-width: 1024px) 22vw, 17vw";

// 通用模糊占位图：zinc-700 色块，5:7 比例，next/image 会自动 blur 处理
const BLUR_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='14'%3E%3Crect width='10' height='14' fill='%233f3f46'/%3E%3C/svg%3E";

export function CardImage({
  src,
  alt,
  className,
  sizes = DEFAULT_SIZES,
  size = "normal",
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  size?: "normal" | "small";
  priority?: boolean;
}) {
  const [errored, setErrored] = useState(false);

  // 弹窗场景用 small 尺寸：URL 中 /normal/ 替换为 /small/
  const imageSrc = size === "small" ? src.replace("/normal/", "/small/") : src;

  // next/image 优化失败时，降级为普通 img 标签直接加载原图
  if (errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageSrc}
        alt={alt}
        className={className}
        loading={priority ? "eager" : "lazy"}
      />
    );
  }

  return (
    <span
      className={"block relative aspect-[5/7] overflow-hidden " + (className ?? "")}
    >
      <Image
        src={imageSrc}
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
        priority={priority}
        loading={priority ? undefined : "lazy"}
        placeholder="blur"
        blurDataURL={BLUR_PLACEHOLDER}
        onError={() => setErrored(true)}
      />
    </span>
  );
}
