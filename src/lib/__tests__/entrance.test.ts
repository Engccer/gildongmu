import { describe, expect, it } from "vitest";
import {
  chooseEntrance,
  entranceRemainder,
  isEntranceCandidate,
  type EntranceCandidate,
} from "../entrance";
import fixtures from "./fixtures/entrance/kakao-entrance-2026-08-16.json";

/**
 * A11 출입구 승격의 판정 계층. fixture는 **카카오 실호출 응답 그대로**이고
 * (2026-08-16, `"{목적지명} 출입구"` 질의), 입력 목적지 이름은 **검색이 실제로 주는
 * POI 이름**이다 — 손으로 고른 질의어를 입력으로 삼으면 파이프라인을 검증하지 못한다.
 */
type Fixture = {
  name: string;
  dest: { lat: number; lng: number };
  isEnd: boolean;
  documents: { place_name: string; category_name: string; x: string; y: string }[];
};

const cases = fixtures as unknown as Record<string, Fixture>;

function candidatesOf(key: string): EntranceCandidate[] {
  return cases[key].documents.map((d) => ({
    name: d.place_name,
    category: d.category_name,
    lat: Number(d.y),
    lng: Number(d.x),
  }));
}

/** 그 목적지에서 자격을 통과하는 후보 이름들. */
function eligibleNames(key: string): string[] {
  const c = cases[key];
  return candidatesOf(key)
    .filter((poi) => isEntranceCandidate(c.name, poi))
    .map((poi) => poi.name);
}

describe("entranceRemainder — 이름 잔여 판정", () => {
  it("접두가 맞고 잔여가 출입구 토큰이면 잔여를 준다", () => {
    expect(entranceRemainder("신명중학교", "신명중학교 정문")).toBe("정문");
    expect(entranceRemainder("고덕그라시움아파트", "고덕그라시움아파트 5번게이트")).toBe("5번게이트");
    expect(entranceRemainder("고덕그라시움아파트", "고덕그라시움아파트 Gate 5")).toBe("gate5");
    expect(entranceRemainder("올림픽공원", "올림픽공원 북2문")).toBe("북2문");
    expect(entranceRemainder("서울아산병원", "서울아산병원 출입구3")).toBe("출입구3");
  });

  it("잔여가 비면 출입구가 아니다 — 승격이 멱등이 되는 규칙", () => {
    // 승격된 목적지를 다시 조회해도 자기 자신은 후보가 아니다.
    expect(entranceRemainder("신명중학교 정문", "신명중학교 정문")).toBeNull();
  });

  it("잔여에 시설명이 남으면 부속시설 출입구다 — 탈락", () => {
    expect(
      entranceRemainder("올림픽공원", "올림픽공원 SK올림픽핸드볼경기장 게이트1-3"),
    ).toBeNull();
    expect(entranceRemainder("서울아산병원", "서울아산병원 동관 후문")).toBeNull();
  });

  it("접두가 아니면 타 시설이다 — 탈락", () => {
    expect(entranceRemainder("서울아산병원", "파크리오아파트 정문")).toBeNull();
    expect(entranceRemainder("올림픽공원", "서울올림픽공원 북1문")).toBeNull();
  });

  it("괄호 부가명·공백을 정규화하고 서수 정문을 받는다", () => {
    expect(entranceRemainder("한빛초등학교", "한빛초등학교(본관) 제2정문")).toBe("제2정문");
    expect(entranceRemainder("행복아파트", "행복아파트 1단지 정문")).toBe("1단지정문");
    // 서수는 `정문`뿐 아니라 `문`에도 붙는다(`제1문`) — 한쪽만 받으면 그 이름의
    // 출입구가 조용히 후보에서 빠진다(독립 리뷰 지적).
    expect(entranceRemainder("한빛초등학교", "한빛초등학교 제1문")).toBe("제1문");
  });

  it("동 단위 입구는 자격 토큰이 아니다 — 단지 전체가 목적지면 다른 목적지다", () => {
    expect(entranceRemainder("행복아파트", "행복아파트 101동 출입구")).toBeNull();
  });
});

describe("isEntranceCandidate — 카테고리 축", () => {
  it("지하철 출구는 입출구 카테고리가 아니라 오탐하지 않는다", () => {
    expect(
      isEntranceCandidate("천호역", {
        name: "천호역 5호선 5번출구",
        category: "교통,수송 > 지하철,전철 > 지하철출구",
        lat: 37.538,
        lng: 127.123,
      }),
    ).toBe(false);
  });

  it("이름이 맞아도 카테고리가 다르면 후보가 아니다", () => {
    expect(
      isEntranceCandidate("서울아산병원", {
        name: "서울아산병원 후문주차장",
        category: "교통,수송 > 교통시설 > 주차장",
        lat: 37.526,
        lng: 127.107,
      }),
    ).toBe(false);
  });
});

describe("실호출 fixture — 자격 통과 집합", () => {
  it("신명중학교: 정문 하나", () => {
    expect(eligibleNames("sinmyeong-middle")).toEqual(["신명중학교 정문"]);
  });

  it("고덕그라시움아파트: 정문·후문·게이트 전부", () => {
    expect(eligibleNames("godeok-grasium").sort()).toEqual(
      [
        "고덕그라시움아파트 1번게이트",
        "고덕그라시움아파트 2게이트",
        "고덕그라시움아파트 3번게이트",
        "고덕그라시움아파트 4번게이트",
        "고덕그라시움아파트 5번게이트",
        "고덕그라시움아파트 Gate 5",
        "고덕그라시움아파트 정문",
        "고덕그라시움아파트 후문",
      ].sort(),
    );
  });

  it("올림픽공원: 부속시설 게이트를 걸러 공원 자체의 문만 남긴다", () => {
    // 응답 최상단 3건이 SK올림픽핸드볼경기장 게이트다 — 카테고리만 보면 그것이 뽑힌다.
    expect(eligibleNames("olympic-park").sort()).toEqual(
      ["올림픽공원 남2문", "올림픽공원 남4문", "올림픽공원 동2문", "올림픽공원 북2문", "올림픽공원 서1문"].sort(),
    );
  });

  it("서울아산병원: 타 시설 혼입과 동관 후문을 걸러 낸다", () => {
    expect(eligibleNames("asan-hospital").sort()).toEqual(
      [
        "서울아산병원 남문",
        "서울아산병원 서문",
        "서울아산병원 정문",
        "서울아산병원 출입구1",
        "서울아산병원 출입구3",
        "서울아산병원 출입구5",
      ].sort(),
    );
  });

  it("천호역: 자기 출입구가 없으면 자격 통과 0건", () => {
    expect(eligibleNames("cheonho-station")).toEqual([]);
  });

  it("강동성심병원: 다른 시설 출입구가 15건을 채워도 자기 것만 남는다", () => {
    expect(eligibleNames("gangdong-sacred-heart")).toEqual(["강동성심병원 정문"]);
  });
});

describe("chooseEntrance — 선택과 이득 게이트", () => {
  const sinmyeong = cases["sinmyeong-middle"];
  const grasium = cases["godeok-grasium"];

  it("등교 코스: 대표 좌표를 정문으로 승격한다", () => {
    const match = chooseEntrance({
      placeName: sinmyeong.name,
      dest: sinmyeong.dest,
      from: { lat: 37.5350, lng: 127.1440 }, // 집 쪽(부지 밖)
      candidates: candidatesOf("sinmyeong-middle"),
    });
    expect(match?.name).toBe("신명중학교 정문");
    // 백로그 A11이 기록한 오프셋(56m)과 같은 규모여야 한다.
    expect(match!.meters).toBeGreaterThan(40);
    expect(match!.meters).toBeLessThan(80);
  });

  it("출발지를 알면 출발지 최근접 출입구를 고른다", () => {
    const west = chooseEntrance({
      placeName: grasium.name,
      dest: grasium.dest,
      from: { lat: 37.5560, lng: 127.1560 }, // 단지 서쪽
      candidates: candidatesOf("godeok-grasium"),
    });
    const east = chooseEntrance({
      placeName: grasium.name,
      dest: grasium.dest,
      from: { lat: 37.5580, lng: 127.1720 }, // 단지 동쪽
      candidates: candidatesOf("godeok-grasium"),
    });
    expect(west?.name).not.toBe(east?.name);
  });

  it("출발지를 모르면 정문을 고른다", () => {
    const match = chooseEntrance({
      placeName: grasium.name,
      dest: grasium.dest,
      from: null,
      candidates: candidatesOf("godeok-grasium"),
    });
    expect(match?.name).toBe("고덕그라시움아파트 정문");
  });

  it("이미 부지 부근에서 출발하면 승격하지 않는다 — 나갔다 되돌아오는 경로가 된다", () => {
    const match = chooseEntrance({
      placeName: grasium.name,
      dest: grasium.dest,
      from: { lat: grasium.dest.lat, lng: grasium.dest.lng }, // 단지 안
      candidates: candidatesOf("godeok-grasium"),
    });
    expect(match).toBeNull();
  });

  it("승격 폭 상한을 넘는 출입구로는 옮기지 않는다 — 도착 문장이 거짓이 된다", () => {
    const far: EntranceCandidate = {
      name: "큰공원 남문",
      category: "교통,수송 > 입출구",
      lat: 37.5205 + 0.009, // 약 1km 북쪽
      lng: 127.1208,
    };
    const match = chooseEntrance({
      placeName: "큰공원",
      dest: { lat: 37.5205, lng: 127.1208 },
      from: { lat: 37.5000, lng: 127.1208 },
      candidates: [far],
    });
    expect(match).toBeNull();
  });

  it("자격 후보가 없으면 null이다(오류가 아니라 승격 없음)", () => {
    expect(
      chooseEntrance({
        placeName: cases["cheonho-station"].name,
        dest: cases["cheonho-station"].dest,
        from: { lat: 37.5300, lng: 127.1200 },
        candidates: candidatesOf("cheonho-station"),
      }),
    ).toBeNull();
  });
});
