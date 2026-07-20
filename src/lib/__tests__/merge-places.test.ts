import { describe, it, expect } from "vitest";
import { mergePlaces } from "../providers/places";
import type { Place } from "../types";

/**
 * 교차 provider 병합(en: 카카오+TourAPI / ko: 카카오+네이버)의 중복 제거 로직.
 *
 * 판정은 두 축의 OR: ① 좌표 4자리 일치(en 정본 — 언어가 달라 이름 비교 불가)
 * ② 50m 이내 + 정규화 이름 가장자리 일치(ko — 두 소스가 같은 장소를 20~30m
 * 어긋난 좌표로 줘 ①이 미적중, "키자니아 서울" 이중 노출 실측 2026-07-20).
 * 좌표·이름 샘플은 실호출 응답에서 가져왔다.
 */

function place(over: Partial<Place> & Pick<Place, "id" | "lat" | "lng">): Place {
  return {
    name: "",
    category: "",
    address: "",
    roadAddress: "",
    ...over,
  };
}

describe("mergePlaces", () => {
  it("primary 전부를 먼저 담고, 그 뒤에 secondary를 이어 붙인다", () => {
    const primary = [place({ id: "kakao-1", lat: 37.5, lng: 127.0 })];
    const secondary = [place({ id: "tour-1", lat: 37.6, lng: 127.1 })];

    const merged = mergePlaces(primary, secondary);

    expect(merged.map((p) => p.id)).toEqual(["kakao-1", "tour-1"]);
  });

  it("좌표가 4자리에서 일치하는 secondary 항목은 제외하고 primary를 남긴다", () => {
    const primary = [
      place({ id: "kakao-gbg", name: "경복궁", lat: 37.57882, lng: 126.97689 }),
    ];
    // 같은 경복궁을 TourAPI가 영문명·미세하게 다른 좌표로 준 경우
    const secondary = [
      place({
        id: "tour-gbg",
        name: "Gyeongbokgung Palace",
        lat: 37.578824,
        lng: 126.976891,
      }),
    ];

    const merged = mergePlaces(primary, secondary);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kakao-gbg");
    expect(merged[0].name).toBe("경복궁");
  });

  it("secondary 내부의 중복 좌표도 한 번만 담는다", () => {
    const primary: Place[] = [];
    const secondary = [
      place({ id: "tour-a", lat: 37.1234, lng: 127.1234 }),
      place({ id: "tour-a2", lat: 37.12341, lng: 127.12339 }),
    ];

    const merged = mergePlaces(primary, secondary);

    expect(merged.map((p) => p.id)).toEqual(["tour-a"]);
  });

  it("빈 입력을 안전하게 처리한다", () => {
    expect(mergePlaces([], [])).toEqual([]);
  });

  // 이하 ko(카카오+네이버) 이름+거리 축 — 좌표 4자리 미적중 오프셋 실측 재현
  it("50m 이내 + 이름 동등이면 좌표 4자리가 달라도 중복으로 제외한다 (키자니아 서울)", () => {
    const primary = [
      place({ id: "kakao-kz", name: "키자니아 서울", lat: 37.5109, lng: 127.0969 }),
    ];
    const secondary = [
      place({ id: "naver-kz", name: "키자니아 서울", lat: 37.5109, lng: 127.0966 }),
    ];

    expect(mergePlaces(primary, secondary).map((p) => p.id)).toEqual(["kakao-kz"]);
  });

  it("접두 일치(지점 접미사만 추가)도 중복으로 본다 (키자니아 부산/부산점)", () => {
    const primary = [
      place({ id: "kakao-bs", name: "키자니아 부산점", lat: 35.1701, lng: 129.1285 }),
    ];
    const secondary = [
      place({ id: "naver-bs", name: "키자니아 부산", lat: 35.1701, lng: 129.1283 }),
    ];

    expect(mergePlaces(primary, secondary).map((p) => p.id)).toEqual(["kakao-bs"]);
  });

  it("앵커 장소명을 가운데에 품는 지점명은 별개 장소로 남긴다 (모모유부 키자니아서울점)", () => {
    const primary = [
      place({ id: "kakao-kz", name: "키자니아 서울", lat: 37.5109, lng: 127.0969 }),
    ];
    const secondary = [
      place({ id: "naver-momo", name: "모모유부 키자니아서울점", lat: 37.5109, lng: 127.0965 }),
    ];

    expect(mergePlaces(primary, secondary)).toHaveLength(2);
  });

  it("이름이 같아도 50m 밖이면 별개 장소다 (서울/충주 신명중학교)", () => {
    const primary = [
      place({ id: "kakao-seoul", name: "신명중학교", lat: 37.5352, lng: 127.1428 }),
    ];
    const secondary = [
      place({ id: "naver-chungju", name: "신명중학교", lat: 36.9911, lng: 127.9259 }),
    ];

    expect(mergePlaces(primary, secondary)).toHaveLength(2);
  });

  it("primary 내부는 같은 좌표라도 중복 판정하지 않는다 (한 건물 안 별개 장소)", () => {
    const primary = [
      place({ id: "kakao-kz", name: "키자니아 서울", lat: 37.5109, lng: 127.0969 }),
      place({ id: "kakao-er", name: "키자니아 응급의학센터", lat: 37.5109, lng: 127.0969 }),
    ];

    expect(mergePlaces(primary, [])).toHaveLength(2);
  });
});
