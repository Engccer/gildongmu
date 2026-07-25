import { describe, it, expect } from "vitest";
import {
  RECENT_CAP,
  loadRecentQueries,
  recordRecentQuery,
  removeRecentQuery,
  clearRecentQueries,
  loadRecentEndpoints,
  recordRecentEndpoint,
  removeRecentEndpoint,
  clearRecentEndpoints,
  type RecentEndpoint,
} from "../recent-searches";

/** 인메모리 Storage 스텁(node env엔 localStorage가 없다 — 주입 경로 검증 겸용). */
function memStorage(seed?: Record<string, string>): Storage {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const QK = "gildongmu:recent-queries:v1";
const EK = "gildongmu:recent-endpoints:v1";

describe("recentQueries", () => {
  it("기록은 trim 후 맨 앞 삽입, 빈 문자열은 무시한다", () => {
    const s = memStorage();
    expect(recordRecentQuery("  경복궁  ", s)).toEqual(["경복궁"]);
    expect(recordRecentQuery("서울역", s)).toEqual(["서울역", "경복궁"]);
    expect(recordRecentQuery("   ", s)).toEqual(["서울역", "경복궁"]);
  });

  it("중복은 새로 만들지 않고 맨 위로 끌어올린다", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    expect(recordRecentQuery("a", s)).toEqual(["a", "b"]);
  });

  it("20개 cap을 넘으면 가장 오래된 항목이 밀려난다", () => {
    const s = memStorage();
    for (let i = 1; i <= RECENT_CAP + 1; i++) recordRecentQuery(`q${i}`, s);
    const list = loadRecentQueries(s);
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0]).toBe(`q${RECENT_CAP + 1}`);
    expect(list).not.toContain("q1");
  });

  it("삭제·전체 삭제", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    expect(removeRecentQuery("a", s)).toEqual(["b"]);
    expect(clearRecentQueries(s)).toEqual([]);
    expect(loadRecentQueries(s)).toEqual([]);
  });

  it("깨진 JSON·비배열·비문자열 요소는 빈 목록/필터로 조용히 복구한다", () => {
    expect(loadRecentQueries(memStorage({ [QK]: "{oops" }))).toEqual([]);
    expect(loadRecentQueries(memStorage({ [QK]: '{"a":1}' }))).toEqual([]);
    expect(loadRecentQueries(memStorage({ [QK]: '["ok", 3]' }))).toEqual(["ok"]);
  });

  it("storage가 없으면(SSR) 빈 목록·no-op", () => {
    expect(loadRecentQueries(null)).toEqual([]);
    expect(recordRecentQuery("a", null)).toEqual([]);
  });
});

describe("recentEndpoints", () => {
  const gyeongbok: RecentEndpoint = { label: "경복궁", lat: 37.579617, lng: 126.977041 };

  it("기록·cap·삭제·전체 삭제가 검색어와 동형으로 동작한다", () => {
    const s = memStorage();
    expect(recordRecentEndpoint(gyeongbok, s)).toEqual([gyeongbok]);
    for (let i = 1; i <= RECENT_CAP; i++)
      recordRecentEndpoint({ label: `p${i}`, lat: i, lng: i }, s);
    expect(loadRecentEndpoints(s)).toHaveLength(RECENT_CAP);
    expect(loadRecentEndpoints(s).some((e) => e.label === "경복궁")).toBe(false);
    const p1 = { label: "p1", lat: 1, lng: 1 };
    expect(removeRecentEndpoint(p1, s).some((e) => e.label === "p1")).toBe(false);
    expect(clearRecentEndpoints(s)).toEqual([]);
  });

  it("좌표 소수 4자리가 같으면 같은 장소 — 최신 라벨로 교체하며 끌어올린다", () => {
    const s = memStorage();
    recordRecentEndpoint(gyeongbok, s);
    recordRecentEndpoint({ label: "서울역", lat: 37.5547, lng: 126.9707 }, s);
    // 소수 5자리째만 다른 좌표(반올림 4자리 동일) + 라벨 변형
    const next = recordRecentEndpoint(
      { label: "경복궁 (고궁)", lat: 37.5796172, lng: 126.9770413 },
      s,
    );
    expect(next).toHaveLength(2);
    expect(next[0].label).toBe("경복궁 (고궁)");
  });

  it("스키마 불일치 요소는 걸러낸다", () => {
    const s = memStorage({ [EK]: '[{"label":"ok","lat":1,"lng":2},{"label":"bad"}]' });
    expect(loadRecentEndpoints(s)).toEqual([{ label: "ok", lat: 1, lng: 2 }]);
  });
});
