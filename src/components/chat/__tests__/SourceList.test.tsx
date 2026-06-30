// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { vi } from "vitest";

afterEach(() => {
  cleanup();
});

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "ko",
}));

import { SourceList } from "../SourceList";

describe("SourceList", () => {
  it("sources 없으면 아무것도 렌더 안 함", () => {
    const { container } = render(<SourceList sources={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("빈 배열이면 아무것도 렌더 안 함", () => {
    const { container } = render(<SourceList sources={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("출처 라벨을 i18n 키로 표시", () => {
    const { container } = render(
      <SourceList
        sources={[
          { label: "source.kakao" },
          { label: "source.airkorea" },
        ]}
      />
    );
    // 한 줄 = 한 접근성 객체: 라벨을 개별 span으로 쪼개지 않고 <p> 텍스트로
    // 합친다 → 개별 요소가 아니라 합쳐진 텍스트로 검증. vi.mock: t(key)는 키 반환.
    const text = container.textContent ?? "";
    expect(text).toContain("sources");
    expect(text).toContain("source.kakao");
    expect(text).toContain("source.airkorea");
  });

  it("url 있으면 링크로 렌더", () => {
    render(
      <SourceList
        sources={[{ label: "source.kakao", url: "https://kakao.com" }]}
      />
    );
    const link = screen.getByRole("link", { name: "source.kakao" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://kakao.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("url 없으면 텍스트(링크 아님)로 렌더", () => {
    const { container } = render(<SourceList sources={[{ label: "source.tago" }]} />);
    expect(container.textContent).toContain("source.tago");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
