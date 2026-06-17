import { describe, it, expect, vi, afterEach } from "vitest";
import playgroundFixture from "./fixtures/kakao-kids-playground.json";
import cafeFixture from "./fixtures/kakao-kids-cafe.json";

// env는 import 시점 동결 — 카카오 키 있음으로 모킹.
vi.mock("../env", () => ({
  env: { KAKAO_REST_API_KEY: "test-key" },
  hasKakaoKey: () => true,
}));

import {
  classifyKidsPlace,
  normalizeKidsDoc,
  rankKidsPlaces,
  findKidsPlacesNear,
} from "../providers/kids-places";
import { env } from "../env";

type RawDoc = {
  id: string;
  place_name: string;
  category_name: string;
  x: string;
  y: string;
  distance: string;
  address_name?: string;
  road_address_name?: string;
  phone?: string;
  place_url?: string;
};

const docs = (f: { documents: RawDoc[] }) => f.documents;
const byName = (f: { documents: RawDoc[] }, name: string) =>
  docs(f).find((d) => d.place_name === name)!;

describe("classifyKidsPlace (카테고리 화이트리스트 — 거짓양성 차단)", () => {
  it("유아>놀이시설>키즈카페 → accept, kidscafe, indoor", () => {
    const c = classifyKidsPlace("가정,생활 > 유아 > 놀이시설 > 키즈카페", "프레리주니어 길동점");
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("kidscafe");
    expect(c.indoorOutdoor).toBe("indoor");
  });

  it("서울형키즈카페 하위 분류도 kidscafe(SPEC 서울형 키즈카페 커버)", () => {
    const c = classifyKidsPlace(
      "가정,생활 > 유아 > 놀이시설 > 키즈카페 > 서울형키즈카페",
      "서울형키즈카페 강동구성내2동점",
    );
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("kidscafe");
  });

  it("유아교육>놀이교육(플레이타임) → accept, playcenter, indoor", () => {
    const c = classifyKidsPlace(
      "교육,학문 > 유아교육 > 놀이교육 > 플레이타임",
      "애플블록앤퍼즐 홈플러스강동점",
    );
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("playcenter");
    expect(c.indoorOutdoor).toBe("indoor");
  });

  it("유아>놀이시설>놀이터 → accept, playground", () => {
    const c = classifyKidsPlace("가정,생활 > 유아 > 놀이시설 > 놀이터", "알록달록 이음놀이터");
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("playground");
  });

  it("공원 + 이름에 '어린이공원' → accept, park, outdoor", () => {
    const c = classifyKidsPlace("여행 > 공원 > 도시근린공원", "성심어린이공원");
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("park");
    expect(c.indoorOutdoor).toBe("outdoor");
  });

  it("공원 + 이름에 '유아' 신호 → accept, park", () => {
    const c = classifyKidsPlace("여행 > 공원 > 도시근린공원", "한들유아숲체험원");
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("park");
  });

  it("공원 + 이름에 '놀이' 신호 → accept, park(놀이공원류 의도 통과)", () => {
    const c = classifyKidsPlace("여행 > 공원 > 도시근린공원", "어울림놀이공원");
    expect(c.accept).toBe(true);
    expect(c.kind).toBe("park");
  });

  it("공원이지만 이름에 키즈 신호 없음(일반 근린공원) → reject", () => {
    expect(classifyKidsPlace("여행 > 공원 > 도시근린공원", "올림픽공원").accept).toBe(false);
  });

  // ⚠ "놀이교육"은 "유아교육 > 놀이교육" 계층으로만 accept — 비-유아 학원 taxonomy
  // (가상 "학원 > 놀이교육학원")가 playcenter로 오통과되면 안 됨(설계 I1 앵커링 회귀).
  it("학원 > 놀이교육학원(비-유아 계층) → reject", () => {
    expect(
      classifyKidsPlace("교육,학문 > 학원 > 놀이교육학원", "튼튼 놀이교육학원").accept,
    ).toBe(false);
  });

  // ⚠ 키워드만 보면 통과하지만 카테고리로 걸러야 하는 거짓양성들 (실 fixture).
  it.each([
    ["스포츠,레저 > 수영,수상 > 스킨스쿠버", "스쿠버놀이터"],
    ["사회,공공기관 > 단체,협회 > 사회복지시설 > 노인복지시설", "쌈지놀이터 3호점"],
    ["가정,생활 > 친목 > 동우회", "드럼 놀이터동호회"],
    ["사회,공공기관 > 단체,협회 > 사회복지시설 > 청소년복지시설", "문화놀이터 와플"],
    ["스포츠,레저 > 당구 > 당구장,포켓볼", "놀이터당구장"],
    ["음식점 > 카페", "놀이터"],
    ["교육,학문 > 학습시설 > 도서관 > 작은도서관", "강동어린이회관 영어책놀이터"],
    ["가정,생활 > 미용 > 화장품 > 향수", "빛나는향기 컬러아로마놀이터"],
    ["교육,학문 > 학원 > 미술학원", "미술놀이터"],
    ["가정,생활 > 여가시설 > 방탈출카페", "레드런 천호점"],
  ])("거짓양성 reject: %s", (cat, name) => {
    expect(classifyKidsPlace(cat, name).accept).toBe(false);
  });
});

describe("indoorOutdoor 3-state (놀이터 모호 → 이름 신호 / unknown)", () => {
  it("놀이터 + 이름에 '자연' → outdoor", () => {
    expect(
      classifyKidsPlace("가정,생활 > 유아 > 놀이시설 > 놀이터", "일자산자연정원놀이터")
        .indoorOutdoor,
    ).toBe("outdoor");
  });
  it("놀이터 + 이름에 '공원' → outdoor", () => {
    expect(
      classifyKidsPlace("가정,생활 > 유아 > 놀이시설 > 놀이터", "허브천문공원 놀이터")
        .indoorOutdoor,
    ).toBe("outdoor");
  });
  it("놀이터 + 이름에 '실내' → indoor", () => {
    expect(
      classifyKidsPlace("가정,생활 > 유아 > 놀이시설 > 놀이터", "튼튼 실내놀이터")
        .indoorOutdoor,
    ).toBe("indoor");
  });
  it("놀이터 + 신호 없음 → unknown(잘못된 단정 금지)", () => {
    expect(
      classifyKidsPlace("가정,생활 > 유아 > 놀이시설 > 놀이터", "알록달록 이음놀이터")
        .indoorOutdoor,
    ).toBe("unknown");
  });
});

describe("normalizeKidsDoc (실 fixture 투영, 거부 시 null)", () => {
  it("키즈카페 doc → KidsPlace(좌표 WGS84·거리 m·id 접두)", () => {
    const k = normalizeKidsDoc(byName(cafeFixture, "프레리주니어 길동점"))!;
    expect(k).not.toBeNull();
    expect(k.id).toBe("kakao-1988755725");
    expect(k.name).toBe("프레리주니어 길동점");
    expect(k.kind).toBe("kidscafe");
    expect(k.indoorOutdoor).toBe("indoor");
    expect(k.distanceMeters).toBe(546);
    expect(k.lat).toBeCloseTo(37.5, 1);
    expect(k.lng).toBeCloseTo(127.1, 1);
  });

  it("거짓양성 doc(스킨스쿠버) → null", () => {
    expect(normalizeKidsDoc(byName(playgroundFixture, "스쿠버놀이터"))).toBeNull();
  });
});

describe("rankKidsPlaces (dedupe·accept 필터·거리 재정렬·cap)", () => {
  it("두 fixture 병합: 노이즈 제거 + 거리 오름차순", () => {
    const merged = rankKidsPlaces([docs(cafeFixture), docs(playgroundFixture)], 20);
    // 전부 accept된 키즈 장소만
    expect(merged.every((k) => k.kind)).toBe(true);
    // 거리 오름차순
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].distanceMeters).toBeGreaterThanOrEqual(merged[i - 1].distanceMeters);
    }
    // 노이즈 이름은 없어야
    const names = merged.map((k) => k.name);
    expect(names).not.toContain("스쿠버놀이터");
    expect(names).not.toContain("놀이터당구장");
    // 가장 가까운 건 546m 프레리주니어
    expect(merged[0].name).toBe("프레리주니어 길동점");
  });

  it("중복 id는 한 번만(여러 키워드 교집합)", () => {
    const one = byName(cafeFixture, "점프런");
    const merged = rankKidsPlaces([[one], [one, one]], 20);
    expect(merged.filter((k) => k.id === "kakao-22485149")).toHaveLength(1);
  });

  it("cap 적용 — 상위 N만", () => {
    const merged = rankKidsPlaces([docs(cafeFixture), docs(playgroundFixture)], 3);
    expect(merged).toHaveLength(3);
  });
});

describe("findKidsPlacesNear (키게이트·3키워드 병합·부분실패)", () => {
  afterEach(() => vi.restoreAllMocks());
  const ok = (json: unknown): Response =>
    ({ ok: true, status: 200, json: async () => json } as unknown as Response);
  const fail = (): Response => ({ ok: false, status: 500, text: async () => "" } as unknown as Response);

  it("키 없음 → [] , fetch 미호출", async () => {
    (env as { KAKAO_REST_API_KEY?: string }).KAKAO_REST_API_KEY = "";
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await findKidsPlacesNear(37.538, 127.139)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    (env as { KAKAO_REST_API_KEY?: string }).KAKAO_REST_API_KEY = "test-key";
  });

  it("3키워드 정상 → 병합·정렬·거짓양성 제거", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(ok(cafeFixture));
    spy.mockResolvedValueOnce(ok(playgroundFixture));
    spy.mockResolvedValueOnce(ok({ documents: [], meta: { total_count: 0 } }));
    const kids = await findKidsPlacesNear(37.538, 127.139);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.map((k) => k.name)).not.toContain("스쿠버놀이터");
    expect(kids[0].distanceMeters).toBeLessThanOrEqual(kids[kids.length - 1].distanceMeters);
  });

  it("일부 키워드 실패 → 나머지 실데이터 보존(부분 실패 불변식)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(ok(cafeFixture));
    spy.mockResolvedValueOnce(fail());
    spy.mockResolvedValueOnce(fail());
    const kids = await findKidsPlacesNear(37.538, 127.139);
    expect(kids.length).toBeGreaterThan(0); // 카페 결과는 살아있다
    expect(kids.every((k) => k.kind === "kidscafe" || k.kind === "playcenter")).toBe(true);
  });

  it("전부 실패 → throw(502 — 조회 실패와 근처 없음 구분)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fail());
    await expect(findKidsPlacesNear(37.538, 127.139)).rejects.toThrow();
  });

  it("전부 빈 결과 → [](graceful, throw 아님)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ documents: [], meta: { total_count: 0 } }),
    );
    expect(await findKidsPlacesNear(37.538, 127.139)).toEqual([]);
  });
});
