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
