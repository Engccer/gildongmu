import { describe, it, expect } from "vitest";
import { normalizeTourItem } from "../providers/tour-api";

describe("normalizeTourItem (TourAPI 4.0)", () => {
  it("TourAPI item을 Place로 정규화한다 (mapx=경도, mapy=위도)", () => {
    const place = normalizeTourItem({
      contentid: "264337",
      contenttypeid: "76",
      title: "Gyeongbokgung Palace (경복궁)",
      addr1: "161, Sajik-ro, Jongno-gu, Seoul",
      addr2: "",
      mapx: "126.9769000000",
      mapy: "37.5788222356",
      tel: "+82-2-3700-3900",
      firstimage: "http://tong.visitkorea.or.kr/cms/resource/sample.jpg",
    });
    expect(place.id).toBe("tour-264337");
    expect(place.name).toContain("Gyeongbokgung");
    expect(place.lat).toBeCloseTo(37.5788, 3);
    expect(place.lng).toBeCloseTo(126.9769, 3);
    expect(place.phone).toBe("+82-2-3700-3900");
    expect(place.roadAddress).toBe("161, Sajik-ro, Jongno-gu, Seoul");
    expect(place.category).toBe("Tourist Attraction");
  });

  it("contenttypeid 라벨 매핑 — 국문/영문 코드 비중첩, 미지 코드는 빈 문자열", () => {
    const base = {
      contentid: "1",
      title: "이름",
      addr1: "주소",
      addr2: "",
      mapx: "127.0",
      mapy: "37.5",
      tel: "",
      firstimage: "",
    };
    // 국문 코드 (2026-06-13 실응답: 경복궁 contenttypeid "12")
    expect(normalizeTourItem({ ...base, contenttypeid: "12" }).category).toBe(
      "관광지",
    );
    expect(normalizeTourItem({ ...base, contenttypeid: "39" }).category).toBe(
      "음식점",
    );
    // 영문 코드 (실응답: 쇼핑 매장 contenttypeid "79")
    expect(normalizeTourItem({ ...base, contenttypeid: "79" }).category).toBe(
      "Shopping",
    );
    // 문서에 없는 코드는 빈 문자열로 폴백 (UI에서 카테고리 줄 생략)
    expect(normalizeTourItem({ ...base, contenttypeid: "999" }).category).toBe(
      "",
    );
  });

  it("addr2가 있으면 지번 주소에 이어 붙이고, 빈 전화번호는 undefined", () => {
    const place = normalizeTourItem({
      contentid: "1",
      contenttypeid: "76",
      title: "이름",
      addr1: "주소1",
      addr2: "별관",
      mapx: "127.0",
      mapy: "37.5",
      tel: "",
      firstimage: "",
    });
    expect(place.address).toBe("주소1 별관");
    expect(place.phone).toBeUndefined();
  });
});
