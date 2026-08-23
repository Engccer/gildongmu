// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

afterEach(() => cleanup());

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { FollowUpChips } from "../FollowUpChips";

describe("FollowUpChips", () => {
  it("빈 배열이면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<FollowUpChips chips={[]} onSelect={vi.fn()} disabled={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("그룹 라벨 안에 칩 버튼을 렌더한다", () => {
    render(<FollowUpChips chips={["a", "b", "c"]} onSelect={vi.fn()} disabled={false} />);
    const group = screen.getByRole("group", { name: "followUpGroupLabel" });
    expect(group.querySelectorAll("button[type='button']")).toHaveLength(3);
  });

  it("클릭 시 onSelect에 칩 텍스트를 넘긴다", () => {
    const onSelect = vi.fn();
    render(<FollowUpChips chips={["질문 하나"]} onSelect={onSelect} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "질문 하나" }));
    expect(onSelect).toHaveBeenCalledWith("질문 하나");
  });

  it("disabled면 aria-disabled이고(disabled 속성 아님) onSelect를 부르지 않는다", () => {
    const onSelect = vi.fn();
    render(<FollowUpChips chips={["q"]} onSelect={onSelect} disabled />);
    const btn = screen.getByRole("button", { name: "q" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
