// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "ko",
}));

const order: string[] = [];
vi.mock("@/components/VoiceRecordButton", () => ({
  VoiceRecordButton: () => (
    <button type="button" onClick={() => order.push("record")}>
      mic
    </button>
  ),
}));

import { ChatInput } from "../ChatInput";

afterEach(cleanup);

describe("ChatInput", () => {
  it("입력 후 전송하면 onSend 호출, 입력 비움", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "길동 카페" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSend).toHaveBeenCalledWith("길동 카페");
    expect(input.value).toBe("");
  });

  it("빈 입력은 전송 안 함", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled={false} />);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("받아쓰기 버튼을 누르면 녹음 처리보다 먼저 onDictationPress(답변 듣기 정지)", () => {
    order.length = 0;
    render(<ChatInput onSend={vi.fn()} disabled={false} onDictationPress={() => order.push("stop")} />);
    fireEvent.click(screen.getByRole("button", { name: "mic" }));
    expect(order).toEqual(["stop", "record"]);
  });
});
