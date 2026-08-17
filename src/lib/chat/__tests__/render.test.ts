import { describe, it, expect } from "vitest";
import { placesToData, placesToRender, addressesToData } from "../render";
import type { JusoAddress } from "@/lib/types";

const place = { id: "1", name: "길동 카페", category: "카페", address: "강동구",
  roadAddress: "강동대로 1", lat: 37.5, lng: 127.1 };

/** Record<string,unknown> 단계 키 내려가는 헬퍼. */
function dig(data: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = data;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

describe("render 헬퍼", () => {
  it("placesToData는 count + 상위 8건 핵심필드", () => {
    const d = placesToData([place]);
    expect(dig(d, "count")).toBe(1);
    expect(dig(d, "places", "0")).toEqual({ name: "길동 카페", category: "카페", address: "강동대로 1" });
  });
  it("placesToRender는 review일 때만 sort를 싣는다(그 외 페이로드 불변)", () => {
    expect(placesToRender([place], "review")).toEqual({ type: "places", places: [place], sort: "review" });
    expect(placesToRender([place], "accuracy")).toEqual({ type: "places", places: [place] });
  });

  it("placesToRender는 places 페이로드", () => {
    expect(placesToRender([place])).toEqual({ type: "places", places: [place] });
  });
  it("addressesToData는 count + roadAddr/zipNo", () => {
    const addr: JusoAddress = { roadAddr: "세종대로 110", roadAddrPart1: "", jibunAddr: "",
      engAddr: "", zipNo: "04524", bdNm: "" };
    const d = addressesToData([addr]);
    expect(dig(d, "addresses", "0")).toEqual({ roadAddr: "세종대로 110", zipNo: "04524" });
  });
});
