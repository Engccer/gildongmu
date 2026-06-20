import { describe, it, expect } from "vitest";
import { matchChatShortcut, appendShortcutHint } from "../keyboard-shortcuts";

const ev = (
  o: Partial<{
    code: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  }>
) => ({ code: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });

describe("matchChatShortcut", () => {
  it("Ctrl+Shift+C → chat-mode", () => {
    expect(matchChatShortcut(ev({ code: "KeyC", ctrlKey: true, shiftKey: true }))).toBe(
      "chat-mode"
    );
  });

  it("Ctrl+Shift+S → search-mode", () => {
    expect(matchChatShortcut(ev({ code: "KeyS", ctrlKey: true, shiftKey: true }))).toBe(
      "search-mode"
    );
  });

  it("Shift+Esc → focus-input", () => {
    expect(matchChatShortcut(ev({ code: "Escape", shiftKey: true }))).toBe("focus-input");
  });

  it("Ctrl+Shift+D → dictation", () => {
    expect(matchChatShortcut(ev({ code: "KeyD", ctrlKey: true, shiftKey: true }))).toBe(
      "dictation"
    );
  });

  it("Alt 섞이면 null", () => {
    expect(
      matchChatShortcut(ev({ code: "KeyC", ctrlKey: true, shiftKey: true, altKey: true }))
    ).toBeNull();
  });

  it("수식 없는 c는 null(입력 충돌 회피)", () => {
    expect(matchChatShortcut(ev({ code: "KeyC" }))).toBeNull();
  });
});

describe("appendShortcutHint", () => {
  it("+를 공백으로 치환해 라벨에 합침", () => {
    expect(appendShortcutHint("채팅", "Control+Shift+C")).toBe("채팅, Control Shift C");
  });

  it("shortcut 없으면 라벨 그대로", () => {
    expect(appendShortcutHint("채팅")).toBe("채팅");
  });
});
