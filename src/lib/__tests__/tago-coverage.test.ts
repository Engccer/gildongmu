import { describe, it, expect } from "vitest";
import { judgeTagoCityCoverage } from "../tago-coverage";

/**
 * 좌표는 전부 실측으로 얻은 카카오 `coord2regioncode` 실제 출력이다(2026-08-02).
 * 표기를 지어내면 이 계층은 통과해도 런타임에서만 틀린다.
 */
describe("judgeTagoCityCoverage", () => {
  it("TAGO 목록에 없는 시군은 uncovered: 이 기능의 존재 이유", () => {
    expect(judgeTagoCityCoverage("강원특별자치도", "강릉시")).toBe("uncovered");
    expect(judgeTagoCityCoverage("강원특별자치도", "속초시")).toBe("uncovered");
    expect(judgeTagoCityCoverage("강원특별자치도", "정선군")).toBe("uncovered");
  });

  it("TAGO 목록에 있는 시군은 covered", () => {
    expect(judgeTagoCityCoverage("강원특별자치도", "춘천시")).toBe("covered");
    expect(judgeTagoCityCoverage("전라남도", "해남군")).toBe("covered");
  });

  it("동명 시군은 도까지 봐야 갈린다: 이름만 보면 강원 고성군이 오판된다", () => {
    // 경남 고성군만 TAGO에 있다(38340). 강원 고성군은 없다.
    expect(judgeTagoCityCoverage("경상남도", "고성군")).toBe("covered");
    expect(judgeTagoCityCoverage("강원특별자치도", "고성군")).toBe("uncovered");
  });

  it("묶음 이름은 각각 매칭된다(원주시/횡성군)", () => {
    expect(judgeTagoCityCoverage("강원특별자치도", "원주시")).toBe("covered");
    expect(judgeTagoCityCoverage("강원특별자치도", "횡성군")).toBe("covered");
    // 계룡시는 코드 25(대전)의 묶음 이름으로도 등장하지만 그 경로는 `0:계룡시`라는
    // 조회 불가 키였다 — 실제로 이 판정을 세우는 것은 seed의 `34070 계룡시`다.
    // (D5의 2자리 코드 제외가 이 답을 바꾸지 않는 이유이기도 하다.)
    expect(judgeTagoCityCoverage("충청남도", "계룡시")).toBe("covered");
  });

  it("등록 정류소가 0인 도시는 코드가 있어도 uncovered(양양군)", () => {
    expect(judgeTagoCityCoverage("강원특별자치도", "양양군")).toBe("uncovered");
  });

  it("특별시·광역시 자치구는 covered: 서울은 TOPIS, 나머지는 TAGO 도시 단위", () => {
    expect(judgeTagoCityCoverage("서울특별시", "강동구")).toBe("covered");
    expect(judgeTagoCityCoverage("부산광역시", "해운대구")).toBe("covered");
    expect(judgeTagoCityCoverage("대구광역시", "중구")).toBe("covered");
  });

  it("광역시 소속 '군'도 covered: 자치구 규칙만 두면 이 넷이 빠진다", () => {
    // 2depth가 `~군`이라 자치구 규칙에 안 걸린다. 시도로 먼저 가르지 않으면 unknown이
    // 되어 fail-open 덕에 우연히 맞을 뿐이다.
    expect(judgeTagoCityCoverage("인천광역시", "강화군")).toBe("covered");
    expect(judgeTagoCityCoverage("인천광역시", "옹진군")).toBe("covered");
    expect(judgeTagoCityCoverage("부산광역시", "기장군")).toBe("covered");
    expect(judgeTagoCityCoverage("울산광역시", "울주군")).toBe("covered");
    expect(judgeTagoCityCoverage("대구광역시", "군위군")).toBe("covered");
  });

  /**
   * ⚠ **검출력 없음을 명시한다**: 자치구 규칙의 공백 조건(`!gun.includes(" ")`)을 지우는
   * 변이는 이 스위트를 통과한다(실측). 일반구를 가진 시(수원·청주·창원·전주·포항 등)가
   * **전부 TAGO 커버**라 두 경로가 같은 답을 내는 등가 변이이기 때문이다. 조건을 남기는
   * 이유는 의미다: `수원시 영통구`는 광역시 자치구가 아니다. 언젠가 일반구를 가진 시가
   * 커버에서 빠지면 그때 이 축에 검출력이 생기고, 그 전까지는 없는 척하지 않는다.
   */
  it("특례시의 구는 자치구와 다르다: 공백 뒤 구를 떼고 시로 매칭한다", () => {
    expect(judgeTagoCityCoverage("경기도", "수원시 영통구")).toBe("covered");
    expect(judgeTagoCityCoverage("충청북도", "청주시 상당구")).toBe("covered");
    expect(judgeTagoCityCoverage("경상남도", "창원시 성산구")).toBe("covered");
  });

  it("세종은 2depth가 비어 있다", () => {
    expect(judgeTagoCityCoverage("세종특별자치시", "")).toBe("covered");
  });

  it("제주는 TAGO가 섬 전체를 제주도 하나로 두어 2depth 이름이 어긋난다", () => {
    expect(judgeTagoCityCoverage("제주특별자치도", "제주시")).toBe("covered");
    expect(judgeTagoCityCoverage("제주특별자치도", "서귀포시")).toBe("covered");
  });

  it("통합 시도(전남광주통합특별시)에서 전남 시군과 광주 자치구가 모두 갈린다", () => {
    // 실측: 카카오·juso 모두 광주광역시와 전라남도를 이 이름으로 준다(TAGO는 아직 옛 이름).
    expect(judgeTagoCityCoverage("전남광주통합특별시", "목포시")).toBe("covered");
    expect(judgeTagoCityCoverage("전남광주통합특별시", "동구")).toBe("covered"); // 광주 자치구
    expect(judgeTagoCityCoverage("전남광주통합특별시", "담양군")).toBe("uncovered");
  });

  it("모르는 시도는 unknown: 개편이 표를 낡게 만들어도 미제공으로 단정하지 않는다", () => {
    expect(judgeTagoCityCoverage("가상통합특별시", "어딘가시")).toBe("unknown");
    expect(judgeTagoCityCoverage("", "")).toBe("unknown");
  });
});
