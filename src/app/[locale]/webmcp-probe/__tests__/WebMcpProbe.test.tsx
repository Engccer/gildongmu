// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { WebMcpProbe } from "../WebMcpProbe";

const translations: Record<string, string | ((values: Record<string, unknown>) => string)> = {
  title: "WebMCP 게이트 0 프로브",
  intro: "WebMCP와 VoiceOver 연결을 확인합니다.",
  supportLabel: "WebMCP 지원 상태",
  "support.checking": "확인 중",
  "support.supported": "지원",
  "support.unsupported": "미지원",
  targetsHeading: "포커스 대상",
  headingTarget: ({ index }) => `포커스 대상 ${index}, 헤딩`,
  buttonTarget: ({ index }) => `포커스 대상 ${index}, 버튼`,
  manualActivation: ({ index }) => `${index}번 버튼을 직접 실행했습니다.`,
  readStateResult: ({ support, focus, lastResult }) =>
    `WebMCP ${support}. 현재 포커스 ${focus}. 최근 결과 ${lastResult}.`,
  focusMoved: ({ label }) => `${label} 항목으로 DOM 포커스를 옮겼습니다.`,
  focusFailed: ({ index }) => `${index}번 항목으로 DOM 포커스를 옮기지 못했습니다.`,
  invalidIndex: "항목 번호는 1부터 5까지의 정수여야 합니다.",
  noFocus: "없음",
  noResult: "없음",
  registrationFailed: "WebMCP 도구 등록에 실패했습니다.",
  "tool.readDescription": "Return the current probe page state.",
  "tool.focusDescription": "Move DOM focus to a numbered probe item.",
  "tool.indexDescription": "Probe item number from 1 to 5.",
};

const translate = (key: string, values: Record<string, unknown> = {}) => {
  const value = translations[key];
  return typeof value === "function" ? value(values) : value ?? key;
};

vi.mock("next-intl", () => ({ useTranslations: () => translate }));

type RegisteredTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<string> | string;
};

function installModelContext(registerTool = vi.fn()) {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool },
  });
  return registerTool;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
});

describe("WebMCP 게이트 0 프로브", () => {
  it("hydration 전에는 지원 여부를 확인 중으로 구분한다", () => {
    const html = renderToString(<WebMcpProbe />);

    expect(html).toContain("WebMCP 지원 상태: 확인 중.");
  });

  it("modelContext가 없으면 미지원으로 표시하고 도구를 등록하지 않는다", async () => {
    render(<WebMcpProbe />);

    expect(await screen.findByText("WebMCP 지원 상태: 미지원.")).toBeTruthy();
  });

  it("modelContext가 있으면 읽기와 포커스 도구를 등록하고 지원으로 표시한다", async () => {
    const registerTool = installModelContext(vi.fn().mockResolvedValue(undefined));
    render(<WebMcpProbe />);

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    expect(screen.getByText("WebMCP 지원 상태: 지원.")).toBeTruthy();

    const tools = registerTool.mock.calls.map(([tool]) => tool as RegisteredTool);
    expect(tools.map((tool) => tool.name)).toEqual([
      "read_current_probe_state",
      "focus_probe_item",
    ]);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
    expect(tools[1].annotations?.readOnlyHint).toBe(false);
  });

  it("포커스 도구가 번호에 맞는 요소로 DOM 포커스를 옮기고 단일 live region에 통지한다", async () => {
    const registerTool = installModelContext(vi.fn().mockResolvedValue(undefined));
    const { container } = render(<WebMcpProbe />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));

    const focusTool = registerTool.mock.calls
      .map(([tool]) => tool as RegisteredTool)
      .find((tool) => tool.name === "focus_probe_item");
    expect(focusTool).toBeDefined();

    const result = await focusTool!.execute({ index: 3 });

    const target = screen.getByRole("heading", { name: "포커스 대상 3, 헤딩" });
    expect(document.activeElement).toBe(target);
    expect(result).toBe("포커스 대상 3, 헤딩 항목으로 DOM 포커스를 옮겼습니다.");
    const liveRegions = container.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions).toHaveLength(1);
    await waitFor(() =>
      expect(liveRegions[0].textContent).toBe(`WebMCP 지원 상태: 지원. ${result}`),
    );
  });

  it("읽기 도구가 지원 상태, 현재 포커스, 최근 결과를 문자열로 반환한다", async () => {
    const registerTool = installModelContext(vi.fn().mockResolvedValue(undefined));
    render(<WebMcpProbe />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));

    screen.getByRole("button", { name: "포커스 대상 2, 버튼" }).focus();
    const readTool = registerTool.mock.calls
      .map(([tool]) => tool as RegisteredTool)
      .find((tool) => tool.name === "read_current_probe_state");
    const result = await readTool!.execute({});

    expect(result).toBe(
      "WebMCP 지원. 현재 포커스 포커스 대상 2, 버튼. 최근 결과 없음.",
    );
  });

  it("읽기 도구를 연속 호출해도 자신의 응답을 최근 결과에 누적하지 않는다", async () => {
    const registerTool = installModelContext(vi.fn().mockResolvedValue(undefined));
    render(<WebMcpProbe />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));

    const readTool = registerTool.mock.calls
      .map(([tool]) => tool as RegisteredTool)
      .find((tool) => tool.name === "read_current_probe_state");
    const first = await readTool!.execute({});
    const second = await readTool!.execute({});

    expect(second).toBe(first);
    expect(second).toContain("최근 결과 없음");
  });

  it("API 지원과 도구 등록 실패를 별도 상태로 알린다", async () => {
    const registerTool = installModelContext(vi.fn().mockRejectedValue(new Error("denied")));
    render(<WebMcpProbe />);

    const liveRegion = await screen.findByText(
      "WebMCP 지원 상태: 지원. WebMCP 도구 등록에 실패했습니다.",
    );
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(registerTool).toHaveBeenCalledTimes(1);
  });
});
