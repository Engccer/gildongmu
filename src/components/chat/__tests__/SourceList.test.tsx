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
    render(
      <SourceList
        sources={[
          { label: "source.kakao" },
          { label: "source.airkorea" },
        ]}
      />
    );
    // vi.mock: t(key)는 키를 그대로 반환
    expect(screen.getByText("sources")).toBeTruthy();
    expect(screen.getByText("source.kakao")).toBeTruthy();
    expect(screen.getByText("source.airkorea")).toBeTruthy();
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
    render(<SourceList sources={[{ label: "source.tago" }]} />);
    expect(screen.getByText("source.tago")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
