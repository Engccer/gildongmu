import { describe, it, expect } from "vitest";
import {
  extractTourItems,
  labelFacilities,
  BARRIER_FREE_FIELD_LABELS,
  normalizeName,
} from "../providers/tour-barrier-free";

describe("extractTourItems", () => {
  it("빈결과 items:'' → 빈 배열", () => {
    const raw = { response: { body: { items: "" } } };
    expect(extractTourItems(raw)).toEqual([]);
  });
  it("단일 객체 item → 배열 1개로 정규화", () => {
    const raw = { response: { body: { items: { item: { contentid: "1" } } } } };
    expect(extractTourItems(raw)).toHaveLength(1);
  });
  it("배열 item → 그대로", () => {
    const raw = { response: { body: { items: { item: [{ contentid: "1" }, { contentid: "2" }] } } } };
    expect(extractTourItems(raw)).toHaveLength(2);
  });
});

describe("labelFacilities — 3-state(값 있는 키만)", () => {
  it("값 있는 화이트리스트 키만 라벨링, 빈 값·미상 키 제외", () => {
    const item = {
      wheelchair: "휠체어 대여 가능(1층 안내데스크)",
      restroom: "",                 // 빈 값 → 제외
      unknownfield: "어떤 값",      // 화이트리스트 밖 → 제외
      braileblock: "점자블록 설치", // 시각
    };
    const out = labelFacilities(item);
    const keys = out.map((f) => f.key);
    expect(keys).toContain("wheelchair");
    expect(keys).toContain("braileblock");
    expect(keys).not.toContain("restroom");
    expect(keys).not.toContain("unknownfield");
    expect(out.find((f) => f.key === "wheelchair")?.label).toBe(
      BARRIER_FREE_FIELD_LABELS["wheelchair"],
    );
  });
  it("모든 필드가 비면 빈 배열", () => {
    expect(labelFacilities({ wheelchair: "", restroom: "   " })).toEqual([]);
  });
});

describe("normalizeName — 보수적 동일성", () => {
  it("괄호·공백·지점 접미 제거", () => {
    expect(normalizeName("국립중앙박물관 (용산)")).toBe("국립중앙박물관");
    expect(normalizeName("스타벅스 강남본점")).toBe("스타벅스 강남".replace(/\s+/g, ""));
  });
  it("다른 이름은 다른 정규화", () => {
    expect(normalizeName("경복궁")).not.toBe(normalizeName("덕수궁"));
  });
});
