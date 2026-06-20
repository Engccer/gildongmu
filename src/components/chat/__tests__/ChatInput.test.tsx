// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "ko",
}));

vi.mock("@/components/VoiceRecordButton", () => ({
  VoiceRecordButton: () => <button>mic</button>,
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
});
