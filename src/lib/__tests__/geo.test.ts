import { describe, it, expect } from "vitest";
import { annotateDistances, haversineMeters, sortPlacesByDistance } from "../geo";
import type { Place } from "../types";

/** 테스트용 최소 Place — 좌표만 의미 있고 나머지는 형태 충족용. */
function place(id: string, lat: number, lng: number): Place {
  return {
    id,
    name: id,
    category: "",
    address: "",
    roadAddress: "",
    lat,
    lng,
  };
}

describe("haversineMeters", () => {
  it("같은 점은 0", () => {
    expect(haversineMeters(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  it("서울역↔시청 ≈ 1.1km(±0.3km)", () => {
    // 서울역(37.5547,126.9707) ↔ 서울시청(37.5663,126.9779)
    const d = haversineMeters(37.5547, 126.9707, 37.5663, 126.9779);
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThan(1500);
  });
});

describe("sortPlacesByDistance", () => {
  const origin = { lat: 37.5, lng: 127.0 };

  it("가까운 순으로 정렬하고 distanceMeters를 부여한다", () => {
    const far = place("far", 37.6, 127.1);
    const near = place("near", 37.501, 127.001);
    const mid = place("mid", 37.55, 127.05);
    const sorted = sortPlacesByDistance([far, near, mid], origin);
    expect(sorted.map((p) => p.id)).toEqual(["near", "mid", "far"]);
    expect(sorted[0].distanceMeters).toBeLessThan(sorted[1].distanceMeters!);
    expect(sorted[1].distanceMeters).toBeLessThan(sorted[2].distanceMeters!);
  });

  it("원본 배열·원소를 변형하지 않는다(순수)", () => {
    const input = [place("a", 37.6, 127.1), place("b", 37.5, 127.0)];
    const snapshot = input.map((p) => ({ ...p }));
    sortPlacesByDistance(input, origin);
    expect(input).toEqual(snapshot); // 순서·필드 모두 그대로
    expect(input[0].distanceMeters).toBeUndefined();
  });

  it("동일 거리는 입력 순서를 보존한다(안정 정렬)", () => {
    const a = place("a", 37.6, 127.0);
    const b = place("b", 37.4, 127.0); // a와 origin 기준 같은 거리(대칭)
    const sorted = sortPlacesByDistance([a, b], origin);
    expect(sorted.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("좌표가 비유한이면 맨 뒤로 보낸다", () => {
    const bad = place("bad", NaN, NaN);
    const good = place("good", 37.51, 127.01);
    const sorted = sortPlacesByDistance([bad, good], origin);
    expect(sorted.map((p) => p.id)).toEqual(["good", "bad"]);
    expect(sorted[1].distanceMeters).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("annotateDistances", () => {
  const origin = { lat: 37.5, lng: 127.0 };
  it("입력 순서를 보존하며 distanceMeters만 부여한다", () => {
    const far = { id: "a", name: "먼곳", category: "", address: "", roadAddress: "", lat: 38.0, lng: 128.0 };
    const near = { id: "b", name: "가까운곳", category: "", address: "", roadAddress: "", lat: 37.5, lng: 127.001 };
    const out = annotateDistances([far, near], origin);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]); // 정렬 안 함
    expect(out[0].distanceMeters).toBeGreaterThan(out[1].distanceMeters!);
  });
  it("비유한 좌표는 distanceMeters를 부여하지 않는다", () => {
    const bad = { id: "c", name: "", category: "", address: "", roadAddress: "", lat: NaN, lng: 127.0 };
    expect(annotateDistances([bad], origin)[0].distanceMeters).toBeUndefined();
  });
  it("입력 배열·원소를 변형하지 않는다", () => {
    const p = { id: "d", name: "", category: "", address: "", roadAddress: "", lat: 37.5, lng: 127.0 };
    const arr = [p];
    annotateDistances(arr, origin);
    expect(p).not.toHaveProperty("distanceMeters");
  });
});
