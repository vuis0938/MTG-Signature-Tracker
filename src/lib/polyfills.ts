/**
 * 客户端 polyfill
 *
 * Next.js 16 默认目标 Safari 16.4+，但部分旧 iOS 设备（如 iOS 15.x）
 * 不支持 Array.prototype.at()、Object.hasOwn()、String.prototype.replaceAll()，
 * 导致 JS 执行报错、React 水合失败、按钮无响应。
 * 此文件通过 instrumentation-client 在 React 水合前加载。
 */

// Array.prototype.at() — Safari 15.4+
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    value: function (index: number) {
      const len = this.length;
      const i = index < 0 ? len + index : index;
      return i >= 0 && i < len ? this[i] : undefined;
    },
    writable: true,
    configurable: true,
  });
}

// String.prototype.at() — Safari 15.4+
if (!String.prototype.at) {
  Object.defineProperty(String.prototype, "at", {
    value: function (index: number) {
      const str = String(this);
      const len = str.length;
      const i = index < 0 ? len + index : index;
      return i >= 0 && i < len ? str.charAt(i) : undefined;
    },
    writable: true,
    configurable: true,
  });
}

// Object.hasOwn() — Safari 15.4+
if (!Object.hasOwn) {
  Object.hasOwn = function (obj: object, prop: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}

// String.prototype.replaceAll() — Safari 13.4+（保险起见加）
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (
    this: string,
    pattern: string | RegExp,
    replacement: string | ((...args: string[]) => string)
  ): string {
    if (pattern instanceof RegExp) {
      if (!pattern.global) {
        throw new TypeError("replaceAll must be called with a global RegExp");
      }
      return this.replace(pattern, replacement as string);
    }
    const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.replace(new RegExp(escaped, "g"), replacement as string);
  };
}
