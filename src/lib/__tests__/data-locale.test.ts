import { describe, it, expect } from "vitest";
import { dataLocale, prefersEnglish } from "../data-locale";

describe("dataLocale", () => {
  it("ko는 ko 데이터", () => {
    expect(dataLocale("ko")).toBe("ko");
  });
  it("en/es/fr/it/ja 등 비한국어는 모두 en 데이터로 합친다", () => {
    expect(dataLocale("en")).toBe("en");
    expect(dataLocale("es")).toBe("en");
    expect(dataLocale("fr")).toBe("en");
    expect(dataLocale("it")).toBe("en");
    expect(dataLocale("ja")).toBe("en");
  });
  it("알 수 없는 로케일도 ko가 아니면 en 데이터", () => {
    expect(dataLocale("zh")).toBe("en");
  });
});

describe("prefersEnglish", () => {
  it("ko만 false, 나머지는 영문 표기 선호", () => {
    expect(prefersEnglish("ko")).toBe(false);
    expect(prefersEnglish("en")).toBe(true);
    expect(prefersEnglish("es")).toBe(true);
    expect(prefersEnglish("fr")).toBe(true);
    expect(prefersEnglish("it")).toBe(true);
    expect(prefersEnglish("ja")).toBe(true);
  });
});
