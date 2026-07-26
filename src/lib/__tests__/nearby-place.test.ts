import { describe, expect, it } from "vitest";
import {
  kidsPlaceToPlace,
  nightClinicToPlace,
  surroundingPlaceToPlace,
} from "../nearby-place";
import { isStation } from "../station-match";
import type { KidsPlace, NightClinic, SurroundingPlace } from "../types";

const kids: KidsPlace = {
  id: "kakao-1",
  name: "한다리어린이공원",
  category: "여행 > 관광,명소 > 공원",
  kind: "park",
  indoorOutdoor: "outdoor",
  distanceMeters: 543,
  address: "경기 구리시 교문동 667-18",
  roadAddress: "경기 구리시 한다리길 1",
  lat: 37.6,
  lng: 127.1,
  phone: "031-550-2474",
  link: "https://place.map.kakao.com/1",
};

const surrounding: SurroundingPlace = {
  id: "kakao-2",
  name: "강동역 4번출구",
  category: "subway",
  categoryRaw: "교통,수송 > 지하철,전철 > 수도권5호선 > 강동역",
  distanceMeters: 80,
  bearing: "se",
  lat: 37.53,
  lng: 127.13,
};

const clinic: NightClinic = {
  id: "C1100",
  name: "새솔어린이병원",
  address: "서울 강동구 천호대로 1000",
  phone: "",
  kind: "병원",
  emergencyClass: "응급의료기관 이외",
  directions: "",
  lat: 37.54,
  lng: 127.14,
  distanceMeters: 1200,
  hours: [],
};

describe("kidsPlaceToPlace", () => {
  it("필드를 그대로 옮기고 풍부한 카테고리를 보존한다", () => {
    const place = kidsPlaceToPlace(kids);
    expect(place).toMatchObject({
      id: "kakao-1",
      name: "한다리어린이공원",
      category: "여행 > 관광,명소 > 공원",
      address: "경기 구리시 교문동 667-18",
      roadAddress: "경기 구리시 한다리길 1",
      lat: 37.6,
      lng: 127.1,
      phone: "031-550-2474",
      link: "https://place.map.kakao.com/1",
    });
  });

  it("roadAddress가 없으면 빈 문자열로 채운다", () => {
    const place = kidsPlaceToPlace({ ...kids, roadAddress: undefined });
    expect(place.roadAddress).toBe("");
  });

  it("키즈 장소는 역이 아니다", () => {
    expect(isStation(kidsPlaceToPlace(kids))).toBe(false);
  });
});

describe("surroundingPlaceToPlace", () => {
  it("categoryRaw를 category로 쓰고 주소는 빈 문자열", () => {
    const place = surroundingPlaceToPlace(surrounding);
    expect(place.category).toBe(
      "교통,수송 > 지하철,전철 > 수도권5호선 > 강동역",
    );
    expect(place.address).toBe("");
    expect(place.roadAddress).toBe("");
  });

  it("지하철 입구는 역으로 판정돼 역 프롬프트를 받는다", () => {
    expect(isStation(surroundingPlaceToPlace(surrounding))).toBe(true);
  });
});

describe("nightClinicToPlace", () => {
  it("종별을 category로 쓰고 빈 전화는 undefined로 떨군다", () => {
    const place = nightClinicToPlace(clinic);
    expect(place.category).toBe("병원");
    expect(place.phone).toBeUndefined();
  });

  // dutyAddr은 도로명 주소(명부 153건 전수 확인) — 지번 슬롯에 넣으면 장소 상세가
  // "지번 주소 …"로 낭독한다. 지번은 소스에 없으므로 비운다.
  it("dutyAddr을 도로명 슬롯에 넣고 지번은 비운다", () => {
    const place = nightClinicToPlace(clinic);
    expect(place.roadAddress).toBe("서울 강동구 천호대로 1000");
    expect(place.address).toBe("");
  });

  it("전화가 있으면 보존한다", () => {
    const place = nightClinicToPlace({ ...clinic, phone: "02-1234-5678" });
    expect(place.phone).toBe("02-1234-5678");
  });

  it("병원은 역이 아니다", () => {
    expect(isStation(nightClinicToPlace(clinic))).toBe(false);
  });
});
