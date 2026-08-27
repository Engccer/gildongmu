import { describe, expect, it } from "vitest";
import { __setNonceForTest, encodeRef, resolveRef, type SearchSnapshot } from "../place-refs";
import type { JusoAddress, Place } from "@/lib/types";

const place = (id: string): Place => ({
  id,
  name: id,
  category: "c",
  address: "a",
  roadAddress: "r",
  lat: 37.5,
  lng: 127.1,
});
const addr: JusoAddress = {
  roadAddr: "서울 중구 세종대로 110",
  roadAddrPart1: "서울 중구 세종대로 110",
  jibunAddr: "태평로1가 31",
  engAddr: "110 Sejong-daero",
  zipNo: "04524",
  bdNm: "",
};
const snap = (attempt: number): SearchSnapshot => ({
  attempt,
  query: "q",
  sort: "accuracy",
  places: [place("p1"), place("p2")],
  addresses: [addr],
});

describe("place-refs(spec §5.3)", () => {
  it("왕복: 장소·주소 ref가 같은 스냅샷에서 풀린다", () => {
    __setNonceForTest("n1");
    const s = snap(3);
    expect(resolveRef(encodeRef(3, "p", 1), s)).toMatchObject({ kind: "place", place: { id: "p2" } });
    expect(resolveRef(encodeRef(3, "a", 0), s)).toMatchObject({
      kind: "address",
      address: { zipNo: "04524" },
    });
  });

  it("검사 순서: nonce → attempt(staleResult) → row(notFound)", () => {
    __setNonceForTest("n1");
    const r = encodeRef(3, "p", 9);
    expect(resolveRef(r, snap(3))).toEqual({ kind: "notFound" });
    expect(resolveRef(encodeRef(2, "p", 0), snap(3))).toEqual({ kind: "staleResult" });
    __setNonceForTest("n2");
    expect(resolveRef(r, snap(3))).toEqual({ kind: "staleResult" });
    expect(resolveRef("garbage", snap(3))).toEqual({ kind: "notFound" });
    expect(resolveRef(encodeRef(3, "p", 0), null)).toEqual({ kind: "staleResult" });
  });
});
