import { describe, it, expect } from "vitest";
import { romanAddressOf, romanNameOf } from "../romanize";
import { mergeBusStops } from "../bus";
import { nightClinicToPlace, kidsPlaceToPlace, sceneItemToPlace } from "../nearby-place";
import { composeOverview } from "../nearby-overview";
import type { BusStop, KidsPlace, NightClinic } from "../types";

/**
 * 서버 투영 계약(spec §7): `nameRoman`은 한글이 있는 이름에만 실리고(라틴 이름·영문 원천은 필드 부재),
 * `Place` 투영과 병합 지점이 그 값을 버리지 않는다. 로마자 규칙 자체는 `romanize.test.ts`가 맡는다.
 */
describe("romanNameOf / romanAddressOf 게이트", () => {
  it("한글 이름에만 로마자를 만들고 라틴·빈 이름은 undefined", () => {
    expect(romanNameOf("강동성심병원")).toBe("Gangdongseongsimbyeongwon");
    expect(romanNameOf("CU")).toBeUndefined();
    expect(romanNameOf("")).toBeUndefined();
    expect(romanNameOf(null)).toBeUndefined();
    // TourAPI en 이름처럼 한글이 없으면 로마자를 만들지 않는다(영문 원천 존중).
    expect(romanNameOf("Gyeongbokgung Palace")).toBeUndefined();
    // TourAPI en 이름이 이미 `Latin (한글)` 병기면 로마자를 만들지 않는다(a11y 감사 실호출 검출).
    expect(romanNameOf("Starbucks Gyeongdong Market (스타벅스 경동1960)")).toBeUndefined();
    expect(romanNameOf("Gyeongbokgung Palace (경복궁)")).toBeUndefined();
  });

  it("NFD로 분해된 한글도 게이트를 지난다(리뷰 검출)", () => {
    expect(romanNameOf("강남".normalize("NFD"))).toBe("Gangnam");
  });

  it("주소판은 행정 단위 붙임표를 켠다", () => {
    expect(romanAddressOf("강동구 길동, 성내로")).toBe("Gangdong-gu Gil-dong, Seongnae-ro");
    expect(romanAddressOf(null)).toBeUndefined();
  });
});

describe("투영 지점이 nameRoman을 보존한다", () => {
  const clinic: NightClinic = {
    id: "h1",
    name: "강동성심병원",
    nameRoman: "Gangdongseongsimbyeongwon",
    address: "서울 강동구 성안로 150",
    phone: "",
    kind: "병원",
    emergencyClass: "",
    directions: "",
    lat: 37.5,
    lng: 127.1,
    distanceMeters: 120,
    hours: [],
  };
  const kids: KidsPlace = {
    id: "kakao-1",
    name: "GS25",
    category: "편의점",
    kind: "kidscafe",
    indoorOutdoor: "indoor",
    distanceMeters: 50,
    address: "",
    lat: 37.5,
    lng: 127.1,
  };

  it("Place 투영이 nameRoman을 넘기고, 없으면 없는 채로 둔다", () => {
    expect(nightClinicToPlace(clinic).nameRoman).toBe("Gangdongseongsimbyeongwon");
    expect(kidsPlaceToPlace(kids).nameRoman).toBeUndefined();
    expect(
      sceneItemToPlace({
        name: "봉래면옥",
        nameRoman: "Bongnaemyeonok",
        distanceMeters: 40,
        road: null,
        category: "restaurant",
        id: "kakao-9",
        lat: 37.5,
        lng: 127.1,
        categoryRaw: "음식점 > 한식",
        roadAddress: null,
      }).nameRoman,
    ).toBe("Bongnaemyeonok");
  });

  it("버스 정류소 병합은 이름에 로마자를 덧붙인다(TAGO·TOPIS 공통 한 곳)", () => {
    const stop = (name: string, distanceMeters: number, source: BusStop["source"]): BusStop => ({
      nodeId: `${source}-${name}`,
      cityCode: "25",
      name,
      lat: 37.5,
      lng: 127.1 + distanceMeters / 100000,
      distanceMeters,
      source,
      arrivalStatus: "ok",
      arrivals: [],
    });
    const merged = mergeBusStops([stop("길동사거리", 80, "tago")], [stop("Seoul Station", 90, "seoul")]);
    expect(merged.map((s) => s.nameRoman)).toEqual(["Gildongsageori", undefined]);
    // 원래 필드는 그대로다(CLI/MCP 계약 additive).
    expect(merged[0].name).toBe("길동사거리");
  });

  it("한눈에 보기는 장소 로마자·역 영문(seed)·위치 문장 로마자를 함께 낸다", () => {
    const { overview } = composeOverview({
      lat: 37.5,
      lng: 127.1,
      address: { road: "서울 강동구 성내로 12", jibun: null },
      region: "강동구 성내동",
      station: {
        name: "길동역",
        nameEn: "Gil-dong",
        lineName: "5호선",
        lat: 37.501,
        lng: 127.1,
        distanceMeters: 200,
      },
      bus: null,
      busUncovered: false,
      food: {
        status: "fulfilled",
        value: {
          places: [
            { name: "봉래면옥", nameRoman: "Bongnaemyeonok", lat: 37.5, lng: 127.1004, distanceMeters: 40 },
          ],
          capped: false,
        },
      },
      cafe: null,
      kids: null,
      events: null,
      barrierFree: null,
    });
    // 위치 문장은 `composeOverview`가 접두 중복을 정리해 만든다 — 그 결과의 주소 로마자와 같아야 한다.
    expect(overview.place).toBeTruthy();
    expect(overview.placeRoman).toBe(romanAddressOf(overview.place));
    expect(overview.placeRoman).toContain("Gangdong-gu Seongnae-dong");
    const transit = overview.bullets[0];
    expect(transit.kind === "transit" && transit.station?.nameEn).toBe("Gil-dong");
    const food = overview.bullets[1];
    expect(food.kind === "food" && food.state === "ok" && food.nearest[0].nameRoman).toBe("Bongnaemyeonok");
  });
});
