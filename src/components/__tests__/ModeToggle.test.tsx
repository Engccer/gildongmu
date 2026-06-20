// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
// keyboard-shortcuts는 순수 함수라 mock 불필요

import { ModeToggle } from "../ModeToggle";

afterEach(() => cleanup());

describe("ModeToggle", () => {
  it("검색 모드면 채팅으로 전환 버튼을 렌더하고 클릭 시 chat을 반환", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="search" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("chat");
  });

  it("채팅 모드면 검색으로 전환 버튼을 렌더하고 클릭 시 search를 반환", () => {
    const onChange = vi.fn();
    render(<ModeToggle mode="chat" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("search");
  });

  it("버튼에 aria-label(단축키 힌트 포함)이 있다", () => {
    render(<ModeToggle mode="search" onChange={vi.fn()} />);
    const btn = screen.getByRole("button");
    const label = btn.getAttribute("aria-label") ?? "";
    expect(label.length).toBeGreaterThan(0);
    // aria-label에 단축키 힌트(Control Shift C)가 포함된다
    expect(label).toContain("Control");
  });
});
