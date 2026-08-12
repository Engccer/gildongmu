import { describe, it, expect } from "vitest";
import {
  RECENT_CAP,
  loadRecentQueries,
  recordRecentQuery,
  removeRecentQuery,
  clearRecentQueries,
  setRecentQueryPinned,
  loadRecentEndpoints,
  recordRecentEndpoint,
  removeRecentEndpoint,
  clearRecentEndpoints,
  setRecentEndpointPinned,
  loadRecentRoutes,
  recordRecentRoute,
  removeRecentRoute,
  clearRecentRoutes,
  setRecentRoutePinned,
  type RecentQuery,
  type RecentEndpoint,
  type RecentRoute,
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

const QK_V1 = "gildongmu:recent-queries:v1";
const QK_V2 = "gildongmu:recent-queries:v2";
const EK = "gildongmu:recent-endpoints-to:v1";

/** 텍스트 투영(순서 단언용) */
const texts = (l: RecentQuery[]) => l.map((q) => q.text);
const q = (text: string, pinned = false): RecentQuery => ({ text, pinned });

describe("recentQueries", () => {
  it("기록은 trim 후 맨 앞 삽입, 빈 문자열은 무시한다", () => {
    const s = memStorage();
    expect(recordRecentQuery("  경복궁  ", s)).toEqual([q("경복궁")]);
    expect(recordRecentQuery("서울역", s)).toEqual([q("서울역"), q("경복궁")]);
    expect(recordRecentQuery("   ", s)).toEqual([q("서울역"), q("경복궁")]);
  });

  it("중복은 새로 만들지 않고 맨 위로 끌어올린다", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    expect(texts(recordRecentQuery("a", s))).toEqual(["a", "b"]);
  });

  it("20개 cap을 넘으면 가장 오래된 항목이 밀려난다", () => {
    const s = memStorage();
    for (let i = 1; i <= RECENT_CAP + 1; i++) recordRecentQuery(`q${i}`, s);
    const list = loadRecentQueries(s);
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0].text).toBe(`q${RECENT_CAP + 1}`);
    expect(texts(list)).not.toContain("q1");
  });

  it("삭제·전체 삭제", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    expect(removeRecentQuery("a", s)).toEqual([q("b")]);
    expect(clearRecentQueries(s)).toEqual([]);
    expect(loadRecentQueries(s)).toEqual([]);
  });

  it("깨진 JSON·비배열·비객체 요소는 빈 목록/필터로 조용히 복구한다", () => {
    expect(loadRecentQueries(memStorage({ [QK_V2]: "{oops" }))).toEqual([]);
    expect(loadRecentQueries(memStorage({ [QK_V2]: '{"a":1}' }))).toEqual([]);
    expect(
      loadRecentQueries(memStorage({ [QK_V2]: '[{"text":"ok"}, 3, "raw"]' })),
    ).toEqual([q("ok")]);
  });

  it("storage가 없으면(SSR) 빈 목록·no-op", () => {
    expect(loadRecentQueries(null)).toEqual([]);
    expect(recordRecentQuery("a", null)).toEqual([]);
  });

  it("v1 문자열 배열을 v2로 승계한다(v1은 지우지 않는다)", () => {
    const s = memStorage({ [QK_V1]: '["a","b"]' });
    expect(loadRecentQueries(s)).toEqual([q("a"), q("b")]);
    // v2가 생기면(첫 저장) 이후 로드는 v2가 정본
    recordRecentQuery("c", s);
    expect(texts(loadRecentQueries(s))).toEqual(["c", "a", "b"]);
    expect(s.getItem(QK_V1)).toBe('["a","b"]');
  });

  it("v1 승계 후 모두 지우면 v1이 부활하지 않는다(빈 v2 ≠ v2 부재)", () => {
    const s = memStorage({ [QK_V1]: '["a","b"]' });
    expect(loadRecentQueries(s)).toHaveLength(2);
    clearRecentQueries(s); // 고정 없음 → v2에 빈 배열 저장
    expect(loadRecentQueries(s)).toEqual([]);
  });

  it("고정하면 고정 블록 맨 뒤로 — 먼저 고정한 항목이 항상 위", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    recordRecentQuery("c", s); // [c, b, a]
    setRecentQueryPinned("a", true, s); // [a(pin), c, b]
    const after = setRecentQueryPinned("b", true, s); // [a(pin), b(pin), c]
    expect(after).toEqual([q("a", true), q("b", true), q("c")]);
  });

  it("고정 해제는 비고정 블록 맨 앞으로 온다", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s); // [b, a]
    setRecentQueryPinned("a", true, s); // [a(pin), b]
    expect(setRecentQueryPinned("a", false, s)).toEqual([q("a"), q("b")]);
  });

  it("고정 항목 재기록은 자리를 유지한다(끌어올리지 않는다)", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s); // [b, a]
    setRecentQueryPinned("a", true, s); // [a(pin), b]
    expect(recordRecentQuery("a", s)).toEqual([q("a", true), q("b")]);
    // 비고정 신규 기록은 고정 블록 바로 뒤로
    expect(texts(recordRecentQuery("c", s))).toEqual(["a", "c", "b"]);
  });

  it("cap 20은 비고정에만 적용된다(고정은 축출 면제)", () => {
    const s = memStorage();
    recordRecentQuery("keep", s);
    setRecentQueryPinned("keep", true, s);
    for (let i = 1; i <= RECENT_CAP + 1; i++) recordRecentQuery(`q${i}`, s);
    const list = loadRecentQueries(s);
    expect(list).toHaveLength(RECENT_CAP + 1); // 고정 1 + 비고정 20
    expect(list[0]).toEqual(q("keep", true));
    expect(texts(list)).not.toContain("q1");
  });

  it("모두 지우기는 고정을 보존한다", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    recordRecentQuery("b", s);
    setRecentQueryPinned("a", true, s);
    expect(clearRecentQueries(s)).toEqual([q("a", true)]);
    expect(loadRecentQueries(s)).toEqual([q("a", true)]);
  });

  it("없는 항목의 고정 토글은 no-op이다", () => {
    const s = memStorage();
    recordRecentQuery("a", s);
    expect(setRecentQueryPinned("ghost", true, s)).toEqual([q("a")]);
  });
});

describe("recentEndpoints", () => {
  const ep = (label: string, lat: number, lng: number, pinned = false): RecentEndpoint => ({
    label,
    lat,
    lng,
    pinned,
  });
  const gyeongbok = ep("경복궁", 37.579617, 126.977041);

  it("기록·cap·삭제·전체 삭제가 검색어와 동형으로 동작한다", () => {
    const s = memStorage();
    expect(recordRecentEndpoint("to", gyeongbok, s)).toEqual([gyeongbok]);
    for (let i = 1; i <= RECENT_CAP; i++)
      recordRecentEndpoint("to", ep(`p${i}`, i, i), s);
    expect(loadRecentEndpoints("to", s)).toHaveLength(RECENT_CAP);
    expect(loadRecentEndpoints("to", s).some((e) => e.label === "경복궁")).toBe(false);
    expect(
      removeRecentEndpoint("to", ep("p1", 1, 1), s).some((e) => e.label === "p1"),
    ).toBe(false);
    expect(clearRecentEndpoints("to", s)).toEqual([]);
  });

  it("좌표 소수 4자리가 같으면 같은 장소 — 최신 라벨로 교체하며 끌어올린다", () => {
    const s = memStorage();
    recordRecentEndpoint("to", gyeongbok, s);
    recordRecentEndpoint("to", ep("서울역", 37.5547, 126.9707), s);
    // 소수 5자리째만 다른 좌표(반올림 4자리 동일) + 라벨 변형
    const next = recordRecentEndpoint(
      "to",
      ep("경복궁 (고궁)", 37.5796172, 126.9770413),
      s,
    );
    expect(next).toHaveLength(2);
    expect(next[0].label).toBe("경복궁 (고궁)");
  });

  it("스키마 불일치 요소는 걸러내고, pinned 없는 기존 데이터는 false로 읽는다", () => {
    const s = memStorage({ [EK]: '[{"label":"ok","lat":1,"lng":2},{"label":"bad"}]' });
    expect(loadRecentEndpoints("to", s)).toEqual([ep("ok", 1, 2)]);
  });

  it("출발지·도착지 기록은 서로 분리 저장된다", () => {
    const s = memStorage();
    recordRecentEndpoint("from", gyeongbok, s);
    expect(loadRecentEndpoints("to", s)).toEqual([]);
    recordRecentEndpoint("to", ep("서울역", 37.5547, 126.9707), s);
    expect(loadRecentEndpoints("from", s)).toEqual([gyeongbok]);
    // 한쪽 전체 삭제가 다른 쪽에 영향 없음
    clearRecentEndpoints("from", s);
    expect(loadRecentEndpoints("from", s)).toEqual([]);
    expect(loadRecentEndpoints("to", s)).toHaveLength(1);
  });

  it("고정: 상단 유지·라벨 갱신 자리 유지·clear 보존·cap 면제", () => {
    const s = memStorage();
    recordRecentEndpoint("to", ep("집", 37.5, 127.1), s);
    recordRecentEndpoint("to", ep("회사", 37.6, 127.0), s); // [회사, 집]
    setRecentEndpointPinned("to", ep("집", 37.5, 127.1), true, s); // [집(pin), 회사]
    expect(loadRecentEndpoints("to", s).map((e) => e.label)).toEqual(["집", "회사"]);
    // 고정 항목 재기록(라벨 변형) → 자리 유지 + 라벨 교체 + 고정 유지
    const relabeled = recordRecentEndpoint("to", ep("우리집", 37.5, 127.1), s);
    expect(relabeled[0]).toEqual(ep("우리집", 37.5, 127.1, true));
    // cap: 고정 1 + 비고정 20
    for (let i = 1; i <= RECENT_CAP + 1; i++)
      recordRecentEndpoint("to", ep(`p${i}`, i, i), s);
    expect(loadRecentEndpoints("to", s)).toHaveLength(RECENT_CAP + 1);
    // clear는 고정만 남긴다
    expect(clearRecentEndpoints("to", s).map((e) => e.label)).toEqual(["우리집"]);
  });
});

describe("recent routes", () => {
  const home = { label: "자택", lat: 37.535, lng: 127.145 };
  const school = { label: "신명중학교", lat: 37.529, lng: 127.138 };
  const homeToSchool: RecentRoute = { from: home, to: school };
  const curToSchool: RecentRoute = { from: null, to: school };
  const labels = (l: RecentRoute[]) => l.map((r) => r.to?.label ?? "cur");

  it("기록은 맨 앞 삽입, 쌍 단위 dedupe(끌어올림)", () => {
    const s = memStorage();
    recordRecentRoute(homeToSchool, s);
    recordRecentRoute(curToSchool, s);
    // 같은 쌍(라벨 변형 포함)은 최신으로 끌어올림
    const relabeled = { from: { ...home, label: "자택 아파트" }, to: school };
    const list = recordRecentRoute(relabeled, s);
    expect(list).toHaveLength(2);
    expect(list[0].from?.label).toBe("자택 아파트");
    expect(list[1].from).toBeNull();
  });

  it("양측 현재 위치 쌍은 기록하지 않는다", () => {
    const s = memStorage();
    expect(recordRecentRoute({ from: null, to: null }, s)).toEqual([]);
    expect(loadRecentRoutes(s)).toEqual([]);
  });

  it("한쪽 null과 place는 다른 쌍이다", () => {
    const s = memStorage();
    recordRecentRoute(homeToSchool, s);
    recordRecentRoute(curToSchool, s);
    expect(loadRecentRoutes(s)).toHaveLength(2);
  });

  it("cap 20 절단", () => {
    const s = memStorage();
    for (let i = 0; i < 25; i++) {
      recordRecentRoute({ from: null, to: { label: `t${i}`, lat: 37 + i * 0.01, lng: 127 } }, s);
    }
    expect(loadRecentRoutes(s)).toHaveLength(20);
  });

  it("remove·clear·파싱 실패 복구", () => {
    const s = memStorage();
    recordRecentRoute(homeToSchool, s);
    recordRecentRoute(curToSchool, s);
    expect(removeRecentRoute(curToSchool, s)).toHaveLength(1);
    expect(clearRecentRoutes(s)).toEqual([]);
    expect(loadRecentRoutes(memStorage({ "gildongmu:recent-routes:v1": "{oops" }))).toEqual([]);
  });

  it("고정: 재기록에도 상단 유지, clear 보존, cap 면제", () => {
    const s = memStorage();
    const toWork: RecentRoute = { from: null, to: { label: "회사", lat: 37.6, lng: 127.0 } };
    recordRecentRoute(homeToSchool, s);
    recordRecentRoute(toWork, s); // [회사, 학교]
    setRecentRoutePinned(homeToSchool, true, s); // [학교(pin), 회사]
    expect(labels(loadRecentRoutes(s))).toEqual(["신명중학교", "회사"]);
    recordRecentRoute(toWork, s); // 재기록해도 고정이 위
    expect(labels(loadRecentRoutes(s))).toEqual(["신명중학교", "회사"]);
    expect(loadRecentRoutes(s)[0].pinned).toBe(true);
    // cap 면제: 고정 1 + 비고정 20
    for (let i = 0; i < 25; i++) {
      recordRecentRoute({ from: null, to: { label: `t${i}`, lat: 37 + i * 0.01, lng: 127 } }, s);
    }
    expect(loadRecentRoutes(s)).toHaveLength(21);
    // clear 보존 + 해제 후 clear는 전량 삭제
    expect(clearRecentRoutes(s)).toHaveLength(1);
    setRecentRoutePinned(loadRecentRoutes(s)[0], false, s);
    expect(clearRecentRoutes(s)).toEqual([]);
  });
});
