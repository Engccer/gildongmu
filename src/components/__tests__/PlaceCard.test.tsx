// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PlaceCard } from "../PlaceCard";
import en from "../../../messages/en.json";
import ko from "../../../messages/ko.json";

/**
 * en 페이지의 한국어 장소 데이터(카카오 이름·분류)는 블록마다 `lang="ko"`(A26). 이름·분류는
 * 이미 별도 블록이라 속성만 단다 — 새 분절은 없다(접근성 헌장 "한 줄 = 한 객체").
 */
afterEach(cleanup);

const base = {
  id: "p1",
  address: "서울 종로구 관훈동 198-42",
  roadAddress: "서울 종로구 인사동5길 38",
  englishAddress: "38 Insadong 5-gil, Jongno-gu, Seoul",
  lat: 37.57,
  lng: 126.98,
};

function renderCard(place: Parameters<typeof PlaceCard>[0]["place"], locale: "en" | "ko" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ko" ? ko : en}>
      <ul>
        <PlaceCard place={place} onOpen={() => {}} />
      </ul>
    </NextIntlClientProvider>,
  );
}

describe("PlaceCard 언어 표기", () => {
  it("한국어 이름·분류 블록에 lang=\"ko\"", () => {
    renderCard({ ...base, name: "경복궁 관훈점", category: "음식점 > 한식", distanceMeters: 120 });
    expect(screen.getByText("경복궁 관훈점").getAttribute("lang")).toBe("ko");
    expect(screen.getByText(/음식점 > 한식/).getAttribute("lang")).toBe("ko");
  });

  it("영문 이름·분류(TourAPI en)는 lang을 달지 않는다", () => {
    renderCard({ ...base, name: "Gyeongbokgung Palace", category: "Tourist Attractions" });
    expect(screen.getByText("Gyeongbokgung Palace").hasAttribute("lang")).toBe(false);
    expect(screen.getByText(/Tourist Attractions/).hasAttribute("lang")).toBe(false);
  });
});

describe("PlaceCard 분류 영문화(A28)", () => {
  const withEn = {
    ...base,
    name: "신명중학교",
    category: "교육,학문 > 학교 > 중학교",
    categoryEn: "Education & Academia > School > Middle School",
    distanceMeters: 1463,
  };

  it("en: categoryEn이 있으면 영문 경로를 그리고 lang을 달지 않는다(거리와 한 줄)", () => {
    renderCard(withEn);
    const line = screen.getByText(/Education & Academia > School > Middle School/);
    expect(line.textContent).toBe("Education & Academia > School > Middle School, about 1.463km");
    expect(line.hasAttribute("lang")).toBe(false);
    expect(screen.queryByText(/교육,학문/)).toBeNull();
  });

  it("en: categoryEn이 없으면(미등재 세그먼트) 한국어 원문 + lang=\"ko\" — 부분 번역 없음", () => {
    renderCard({ ...withEn, categoryEn: undefined });
    const line = screen.getByText(/교육,학문 > 학교 > 중학교/);
    expect(line.getAttribute("lang")).toBe("ko");
  });

  it("ko: categoryEn이 실려 있어도 원문을 그린다(ko 화면 byte-identical)", () => {
    renderCard(withEn, "ko");
    expect(screen.getByText(/교육,학문 > 학교 > 중학교/)).toBeTruthy();
    expect(screen.queryByText(/Middle School/)).toBeNull();
  });
});
