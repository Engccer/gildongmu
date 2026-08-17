import { describe, expect, it } from "vitest";
import {
  barrierFreePlaceToPlace,
  kidsPlaceToPlace,
  nightClinicToPlace,
  surroundingPlaceToPlace,
} from "@/lib/nearby-place";

// iOS Kit PlaceProjection.swift와 같은 규칙: 도로명만 있는 소스는 roadAddress에, 지번은 비운다.
// 채팅 nearby류 렌더의 `places`가 이 투영을 지나 iOS 상세 진입 근거가 된다(BACKLOG B9).

describe("nearby-place 투영", () => {
  it("소아 진료: dutyAddr은 도로명 → roadAddress, 빈 전화는 undefined", () => {
    const p = nightClinicToPlace({
      id: "A1", name: "길동소아과", address: "서울 강동구 천호대로 1", phone: "", kind: "의원",
      emergencyClass: "", directions: "", lat: 37.5, lng: 127.1, distanceMeters: 320,
    } as never);
    expect(p).toMatchObject({ id: "A1", category: "의원", address: "", roadAddress: "서울 강동구 천호대로 1" });
    expect(p.phone).toBeUndefined();
    expect(p.distanceMeters).toBe(320);
  });

  it("아이 놀 곳: 카카오 필드 그대로, roadAddress 부재는 빈 문자열", () => {
    const p = kidsPlaceToPlace({
      id: "kakao-1", name: "키즈카페", category: "여가 > 키즈카페", kind: "kidsCafe", indoorOutdoor: "indoor",
      distanceMeters: 120, address: "지번", lat: 37.5, lng: 127.1, phone: "02-1", link: "https://x",
    } as never);
    expect(p).toMatchObject({ address: "지번", roadAddress: "", phone: "02-1", link: "https://x", distanceMeters: 120 });
  });

  it("둘러보기: categoryRaw가 category(역 판정용), roadAddress null은 빈 문자열", () => {
    const p = surroundingPlaceToPlace({
      id: "s1", name: "강동역 3번출구", category: "subway", categoryRaw: "교통,수송 > 지하철,전철",
      distanceMeters: 30, bearing: "N", lat: 37.5, lng: 127.1, roadAddress: null,
    } as never);
    expect(p).toMatchObject({ category: "교통,수송 > 지하철,전철", address: "", roadAddress: "" });
  });

  it("무장애: contentId가 id, addr1은 도로명", () => {
    const p = barrierFreePlaceToPlace({
      contentId: "c9", name: "덕수궁", category: "관광지", address: "서울특별시 중구 세종대로 99",
      lat: 37.5, lng: 126.9, distanceMeters: 500,
    });
    expect(p).toMatchObject({ id: "c9", address: "", roadAddress: "서울특별시 중구 세종대로 99", distanceMeters: 500 });
  });
});
