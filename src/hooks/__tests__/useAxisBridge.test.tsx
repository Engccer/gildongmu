// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PlaceBridgeContext, useAxisBridge, type PlaceBridgeRegistrar } from "../useAxisBridge";
import type { AxisSource } from "@/lib/webmcp/tools/context";

function Child({ source }: { source: AxisSource }) {
  useAxisBridge("timetable", source, 0);
  return null;
}

describe("useAxisBridge", () => {
  it("마운트에 attach, 언마운트에 detach", () => {
    const attached: string[] = [];
    let detached = 0;
    const registrar: PlaceBridgeRegistrar = {
      notifyCommit: () => {},
      attach: (axis) => {
        attached.push(axis);
        return () => {
          detached++;
        };
      },
    };
    const source: AxisSource = { read: () => ({ status: "idle", gen: 0 }), load: () => {} };
    const view = render(
      <PlaceBridgeContext.Provider value={registrar}>
        <Child source={source} />
      </PlaceBridgeContext.Provider>,
    );
    expect(attached).toEqual(["timetable"]);
    view.unmount();
    expect(detached).toBe(1);
  });
  it("registrar가 없으면(상세 밖 렌더) 아무것도 하지 않는다", () => {
    const source: AxisSource = { read: () => ({ status: "idle", gen: 0 }), load: () => {} };
    expect(() => render(<Child source={source} />)).not.toThrow();
  });
});
