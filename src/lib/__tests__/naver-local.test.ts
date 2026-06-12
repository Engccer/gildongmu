import { describe, it, expect } from "vitest";
import { normalizeItem, stripHtml, toWgs84 } from "../providers/naver-local";

describe("stripHtml", () => {
  it("<b> 강조 태그를 제거한다", () => {
    expect(stripHtml("<b>경복궁</b> 매표소")).toBe("경복궁 매표소");
  });

  it("HTML 엔티티를 복원한다", () => {
    expect(stripHtml("카페 &amp; 베이커리")).toBe("카페 & 베이커리");
  });
});

describe("toWgs84", () => {
  it("× 10^7 정수 좌표를 십진 도로 변환한다", () => {
    expect(toWgs84("1269770410")).toBeCloseTo(126.977041, 6);
    expect(toWgs84("375796170")).toBeCloseTo(37.579617, 6);
  });

  it("숫자가 아닌 입력은 에러를 던진다", () => {
    expect(() => toWgs84("abc")).toThrow();
  });
});

describe("normalizeItem", () => {
  it("네이버 지역 검색 응답 item을 Place로 정규화한다", () => {
    const place = normalizeItem(
      {
        title: "<b>경복궁</b>",
        link: "http://www.royalpalace.go.kr",
        category: "여행,명소>고궁,문화유산",
        description: "",
        telephone: "02-3700-3900",
        address: "서울특별시 종로구 세종로 1-91",
        roadAddress: "서울특별시 종로구 사직로 161",
        mapx: "1269770410",
        mapy: "375796170",
      },
      0,
    );
    expect(place.name).toBe("경복궁");
    expect(place.lat).toBeCloseTo(37.579617, 6);
    expect(place.lng).toBeCloseTo(126.977041, 6);
    expect(place.phone).toBe("02-3700-3900");
  });

  it("빈 전화번호는 undefined가 된다", () => {
    const place = normalizeItem(
      {
        title: "이름",
        link: "",
        category: "분류",
        description: "",
        telephone: "",
        address: "주소",
        roadAddress: "도로명",
        mapx: "1269770410",
        mapy: "375796170",
      },
      1,
    );
    expect(place.phone).toBeUndefined();
  });
});
