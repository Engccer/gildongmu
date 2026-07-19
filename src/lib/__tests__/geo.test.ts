import { describe, it, expect } from "vitest";
import { annotateDistances, haversineMeters } from "../geo";

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
