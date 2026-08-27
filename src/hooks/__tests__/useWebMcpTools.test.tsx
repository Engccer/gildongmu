// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useWebMcpTools } from "../useWebMcpTools";
import type { WebMcpTool } from "@/lib/webmcp/types";

type Registered = { tool: WebMcpTool; signal: AbortSignal | undefined };

function installModelContext() {
  const registered: Registered[] = [];
  const registerTool = vi.fn(async (tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
    registered.push({ tool, signal: options?.signal });
  });
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
  return { registerTool, registered };
}

function makeTools(n: number, seen: Array<AbortSignal | undefined> = []): WebMcpTool[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `tool_${i}`,
    description: "d",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (_input, context) => {
      seen.push(context?.signal);
      return "ok";
    },
  }));
}

function Harness({ tools, enabled = true }: { tools: WebMcpTool[]; enabled?: boolean }) {
  const [count, setCount] = useState(0);
  useWebMcpTools(() => tools, { enabled });
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      {count}
    </button>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
});

describe("useWebMcpTools(spec §5.1)", () => {
  it("마운트 1회에 도구 수만큼 등록하고, 상태 변경 후 추가 등록은 0이다", async () => {
    const { registerTool } = installModelContext();
    const view = render(<Harness tools={makeTools(9)} />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(9));
    view.getByRole("button").click();
    view.rerender(<Harness tools={makeTools(9)} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(registerTool).toHaveBeenCalledTimes(9);
  });

  it("언마운트가 등록 signal을 abort한다", async () => {
    const { registerTool, registered } = installModelContext();
    const view = render(<Harness tools={makeTools(2)} />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const signals = registered.map((r) => r.signal);
    expect(signals.every((s) => s && !s.aborted)).toBe(true);
    view.unmount();
    expect(signals.every((s) => s?.aborted)).toBe(true);
  });

  it("런타임이 없으면 등록도 경고도 없다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness tools={makeTools(3)} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("실행 signal은 등록 signal과 호스트 signal을 합친다", async () => {
    const { registerTool, registered } = installModelContext();
    const seen: Array<AbortSignal | undefined> = [];
    const view = render(<Harness tools={makeTools(1, seen)} />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
    const host = new AbortController();
    await registered[0].tool.execute({}, { signal: host.signal });
    expect(seen[0]).toBeDefined();
    expect(seen[0]?.aborted).toBe(false);
    host.abort();
    expect(seen[0]?.aborted).toBe(true);
    // 호스트가 signal을 안 줘도 등록 signal은 실린다.
    await registered[0].tool.execute({});
    expect(seen[1]).toBeDefined();
    view.unmount();
    expect(seen[1]?.aborted).toBe(true);
  });

  it("enabled가 false→true로 바뀌면 그때 등록하고, true→false는 해제한다", async () => {
    const { registerTool, registered } = installModelContext();
    const view = render(<Harness tools={makeTools(1)} enabled={false} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(registerTool).not.toHaveBeenCalled();
    view.rerender(<Harness tools={makeTools(1)} enabled />);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
    view.rerender(<Harness tools={makeTools(1)} enabled={false} />);
    expect(registered[0].signal?.aborted).toBe(true);
  });

  it("등록이 throw하면 나머지를 등록하지 않고 onRegisterError를 부른다", async () => {
    const registerTool = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
    const onError = vi.fn();
    function H() {
      useWebMcpTools(() => makeTools(3), { enabled: true, onRegisterError: onError });
      return null;
    }
    render(<H />);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(registerTool).toHaveBeenCalledTimes(1);
  });
});
