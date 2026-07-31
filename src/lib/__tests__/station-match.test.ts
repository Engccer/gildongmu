import { describe, it, expect } from "vitest";
import {
  isStation,
  normalizeStationName,
  parseStationQuery,
  lineHintMatches,
  stripStationDecorations,
} from "../station-match";

const place = (name: string, category: string) => ({
  id: "x",
  name,
  category,
  address: "",
  roadAddress: "",
  lat: 0,
  lng: 0,
});

describe("isStation", () => {
  it("카테고리에 지하철/철도/기차가 있으면 역", () => {
    expect(isStation(place("서울역", "교통,수송>지하철,전철"))).toBe(true);
    expect(isStation(place("행신역", "교통 > 기차"))).toBe(true);
  });
  it("이름이 역으로 끝나면 역", () => {
    expect(isStation(place("청량리역", "기타"))).toBe(true);
  });
  it("Station으로 끝나도 역(영문) — 이름 접미사로 판정", () => {
    expect(isStation(place("Seoul Station", "Transport > Subway"))).toBe(true);
    // 카테고리에 역 키워드가 없어도 이름 접미사만으로 true
    expect(isStation(place("Seoul Station", "Tourist attraction"))).toBe(true);
  });
  it("카테고리에 'Stationery'(문구)가 있어도 역 아님 — Station 오탐 방지", () => {
    expect(isStation(place("모닝글로리", "Shopping > Stationery"))).toBe(false);
  });
  it("음식점은 역 아님", () => {
    expect(isStation(place("역전국밥", "음식점>한식"))).toBe(false);
  });
});

describe("normalizeStationName", () => {
  it("접미사 역/station 제거 + 공백 정리", () => {
    expect(normalizeStationName("서울역")).toBe("서울");
    expect(normalizeStationName("Seoul Station")).toBe("seoul");
    expect(normalizeStationName("청량리역 ")).toBe("청량리");
  });
});

describe("역명 정규화 확장 (카카오 노선 접미·괄호 부가명)", () => {
  it("카카오 실명의 노선 접미를 제거한다", () => {
    expect(normalizeStationName("강동역 5호선")).toBe("강동");
    expect(normalizeStationName("굽은다리역 5호선")).toBe("굽은다리");
    expect(normalizeStationName("강남역 신분당선")).toBe("강남");
    expect(normalizeStationName("서울역 공항철도")).toBe("서울"); // "공항철도"는 선 미종결, 아래 참조
  });
  it("괄호 부가명을 제거한다 (TAGO·CSV 변형)", () => {
    expect(normalizeStationName("청량리(서울시립대입구)")).toBe("청량리");
    expect(normalizeStationName("동대문(4)")).toBe("동대문");
    expect(normalizeStationName("서울역 (1)")).toBe("서울");
    expect(normalizeStationName("굽은다리(강동구민회관앞)")).toBe("굽은다리");
  });
  it("무공백 역명·기존 케이스는 불변", () => {
    expect(normalizeStationName("선릉")).toBe("선릉");
    expect(normalizeStationName("선바위역")).toBe("선바위");
    expect(normalizeStationName("강동")).toBe("강동");
    expect(normalizeStationName("Gangdong Station")).toBe("gangdong");
  });
});

describe("parseStationQuery: 노선 힌트 보존", () => {
  it("노선 토큰을 힌트로 분리한다", () => {
    expect(parseStationQuery("양평역 5호선")).toEqual({ nameKey: "양평", lineHint: "5호선" });
    expect(parseStationQuery("강동역")).toEqual({ nameKey: "강동" });
  });
  it("공항철도류 비-선 접미 토큰도 힌트가 된다", () => {
    expect(parseStationQuery("서울역 공항철도")).toEqual({ nameKey: "서울", lineHint: "공항철도" });
  });
});

describe("lineHintMatches", () => {
  it("완전 일치·접두 포함을 허용한다", () => {
    expect(lineHintMatches("5호선", "5호선")).toBe(true);
    expect(lineHintMatches("공항", "공항철도")).toBe(true); // TAGO 축약 ↔ 카카오 전체명
    expect(lineHintMatches("경의중앙", "경의중앙선")).toBe(true);
  });
  it("다른 노선을 거부한다 (1호선 vs 11호선 포함)", () => {
    expect(lineHintMatches("경의중앙", "5호선")).toBe(false);
    expect(lineHintMatches("11호선", "1호선")).toBe(false);
  });
  it("구분자 표기 차이를 흡수한다 (ODsay ↔ TAGO 실측)", () => {
    expect(lineHintMatches("수인분당", "수인.분당선")).toBe(true);
    expect(lineHintMatches("수인분당", "수인·분당선")).toBe(true);
    expect(lineHintMatches("신분당", "신분당선")).toBe(true);
  });
  it("구분자를 지워도 다른 노선이 섞이지 않는다", () => {
    // 지역이 붙은 TAGO 노선명(인천1호선)은 숫자 완전 일치 규칙이 계속 갈라낸다.
    expect(lineHintMatches("인천1호선", "1호선")).toBe(false);
    expect(lineHintMatches("인천1호선", "인천1호선")).toBe(true);
    expect(lineHintMatches("수인분당", "신분당선")).toBe(false);
  });
});
