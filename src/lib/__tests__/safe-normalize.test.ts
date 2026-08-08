import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeNormalize } from "../match-utils";

// ═════════════════════════════════════════════════════════════
// safeNormalize
// ═════════════════════════════════════════════════════════════

describe("safeNormalize", () => {
  describe("正常路径：normalize('NFD') 成功", () => {
    it("纯 ASCII 直接返回", () => {
      expect(safeNormalize("Alice")).toBe("Alice");
    });

    it("移除单个变音符号 (Ć → C)", () => {
      expect(safeNormalize("Milivoj Ćeran")).toBe("Milivoj Ceran");
    });

    it("移除多个变音符号 (ń + ś + ź)", () => {
      expect(safeNormalize("Kasia 'Kafis' Zielińska")).toBe("Kasia 'Kafis' Zielinska");
    });

    it("空字符串", () => {
      expect(safeNormalize("")).toBe("");
    });

    it("带数字和标点的字符串", () => {
      expect(safeNormalize("John #1 Avon")).toBe("John #1 Avon");
    });

    it("大小写混合的变音符号", () => {
      expect(safeNormalize("Éric Déschamps")).toBe("Eric Deschamps");
    });
  });

  describe("降级路径：normalize('NFD') 抛异常（模拟 UC 浏览器 ICU 崩溃）", () => {
    const originalNormalize = String.prototype.normalize;

    beforeEach(() => {
      // Mock normalize 抛异常，模拟 UC 浏览器 ICU 崩溃
      String.prototype.normalize = vi.fn(() => {
        throw new Error("Internal error. Icu error.");
      });
    });

    afterEach(() => {
      String.prototype.normalize = originalNormalize;
    });

    // ─── 小写变音字符 ───

    it("àáâãäå → a", () => {
      expect(safeNormalize("àáâãäå")).toBe("aaaaaa");
    });

    it("èéêë → e", () => {
      expect(safeNormalize("èéêë")).toBe("eeee");
    });

    it("ìíîï → i", () => {
      expect(safeNormalize("ìíîï")).toBe("iiii");
    });

    it("òóôõö → o", () => {
      expect(safeNormalize("òóôõö")).toBe("ooooo");
    });

    it("ùúûü → u", () => {
      expect(safeNormalize("ùúûü")).toBe("uuuu");
    });

    it("ýÿ → y", () => {
      expect(safeNormalize("ýÿ")).toBe("yy");
    });

    it("ñ → n", () => {
      expect(safeNormalize("España")).toBe("Espana");
    });

    it("ç → c", () => {
      expect(safeNormalize("François")).toBe("Francois");
    });

    // ─── 大写变音字符 ───

    it("ÀÁÂÃÄÅ → A", () => {
      expect(safeNormalize("ÀÁÂÃÄÅ")).toBe("AAAAAA");
    });

    it("ÈÉÊË → E", () => {
      expect(safeNormalize("ÈÉÊË")).toBe("EEEE");
    });

    it("ÌÍÎÏ → I", () => {
      expect(safeNormalize("ÌÍÎÏ")).toBe("IIII");
    });

    it("ÒÓÔÕÖ → O", () => {
      expect(safeNormalize("ÒÓÔÕÖ")).toBe("OOOOO");
    });

    it("ÙÚÛÜ → U", () => {
      expect(safeNormalize("ÙÚÛÜ")).toBe("UUUU");
    });

    it("ÝŸ → Y", () => {
      expect(safeNormalize("ÝŸ")).toBe("YY");
    });

    it("Ñ → N", () => {
      expect(safeNormalize("Ñ")).toBe("N");
    });

    it("Ç → C", () => {
      expect(safeNormalize("Ç")).toBe("C");
    });

    // ─── 斯拉夫语系变音字符 ───

    it("š → s, Š → S", () => {
      expect(safeNormalize("š")).toBe("s");
      expect(safeNormalize("Š")).toBe("S");
    });

    it("ž → z, Ž → Z", () => {
      expect(safeNormalize("ž")).toBe("z");
      expect(safeNormalize("Ž")).toBe("Z");
    });

    it("ćč → c, ĆČ → C", () => {
      expect(safeNormalize("ćč")).toBe("cc");
      expect(safeNormalize("ĆČ")).toBe("CC");
    });

    it("đ → d, Đ → D", () => {
      expect(safeNormalize("đ")).toBe("d");
      expect(safeNormalize("Đ")).toBe("D");
    });

    it("ł → l, Ł → L", () => {
      expect(safeNormalize("ł")).toBe("l");
      expect(safeNormalize("Ł")).toBe("L");
    });

    it("ń → n, Ń → N", () => {
      expect(safeNormalize("ń")).toBe("n");
      expect(safeNormalize("Ń")).toBe("N");
    });

    it("ś → s, Ś → S", () => {
      expect(safeNormalize("ś")).toBe("s");
      expect(safeNormalize("Ś")).toBe("S");
    });

    it("ź → z, Ź → Z", () => {
      expect(safeNormalize("ź")).toBe("z");
      expect(safeNormalize("Ź")).toBe("Z");
    });

    // ─── 特殊连字 ───

    it("æ → ae, Æ → AE", () => {
      expect(safeNormalize("Encyclopædia")).toBe("Encyclopaedia");
      expect(safeNormalize("Æther")).toBe("AEther");
    });

    it("œ → oe, Œ → OE", () => {
      expect(safeNormalize("œuvre")).toBe("oeuvre");
      expect(safeNormalize("Œuvre")).toBe("OEuvre");
    });

    it("ø → o, Ø → O", () => {
      expect(safeNormalize("Søren")).toBe("Soren");
      expect(safeNormalize("Øystein")).toBe("Oystein");
    });

    it("ß → ss", () => {
      expect(safeNormalize("Straße")).toBe("Strasse");
    });

    // ─── 综合场景：真实画家名 ───

    it("真实画家名降级匹配：Milivoj Ćeran", () => {
      expect(safeNormalize("Milivoj Ćeran")).toBe("Milivoj Ceran");
    });

    it("真实画家名降级匹配：Kasia 'Kafis' Zielińska", () => {
      expect(safeNormalize("Kasia 'Kafis' Zielińska")).toBe("Kasia 'Kafis' Zielinska");
    });

    it("真实画家名降级匹配：François-René", () => {
      expect(safeNormalize("François-René")).toBe("Francois-Rene");
    });

    it("混合大小写变音：Éric Déschamps", () => {
      expect(safeNormalize("Éric Déschamps")).toBe("Eric Deschamps");
    });
  });

  describe("边界情况", () => {
    it("纯 ASCII 字符串不受影响", () => {
      expect(safeNormalize("Hello World 123")).toBe("Hello World 123");
    });

    it("中文不受影响", () => {
      expect(safeNormalize("万智牌签绘")).toBe("万智牌签绘");
    });

    it("日文假名不受影响", () => {
      expect(safeNormalize("こんにちは")).toBe("こんにちは");
    });

    it("emoji 不受影响", () => {
      expect(safeNormalize("🎨")).toBe("🎨");
    });
  });
});