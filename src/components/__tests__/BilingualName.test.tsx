// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PlaceCard } from "../PlaceCard";
import { AddressResultList } from "../AddressResultList";
import en from "../../../messages/en.json";
import ko from "../../../messages/ko.json";

/**
 * 장소명 영문 병기 렌더 계약(E28, spec §5 R1~R4). jsdom은 AX 분절을 재지 못하므로(그 축은 Chrome AX
 * 실측이 정본) 여기서는 **구조**를 못 박는다: 괄호 span이 `aria-hidden`·`lang="ko"`이고 컨테이너의
 * 마지막 자식이며, 접근 텍스트(hidden 제외)에 한글이 없고, ko 로케일은 byte-identical이다.
 */
afterEach(cleanup);

const base = {
  id: "p1",
  category: "음식점 > 한식",
  address: "서울 종로구 관훈동 198-42",
  roadAddress: "서울 종로구 인사동5길 38",
  englishAddress: "38 Insadong 5-gil, Jongno-gu, Seoul",
  lat: 37.57,
  lng: 126.98,
  distanceMeters: 120,
};

function renderCard(locale: "en" | "ko", place: Parameters<typeof PlaceCard>[0]["place"]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : ko}>
      <ul>
        <PlaceCard place={place} onOpen={() => {}} />
      </ul>
    </NextIntlClientProvider>,
  );
}

/** aria-hidden 부분을 뺀 텍스트 — 스크린 리더가 실제로 받는 문자열의 근사. */
function accessibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent ?? "";
}

describe("PlaceCard 병기(R1 이름 단독 블록)", () => {
  it("en: 로마자가 접근 텍스트이고 한글은 마지막 자식 aria-hidden span, lang은 뗀다", () => {
    renderCard("en", { ...base, name: "경복궁 관훈점", nameRoman: "Gyeongbokgung Gwanhunjeom" });
    const nameBlock = screen.getByText("Gyeongbokgung Gwanhunjeom", { exact: false }).closest("span.block")!;
    expect(accessibleText(nameBlock)).toBe("Gyeongbokgung Gwanhunjeom");
    expect(nameBlock.hasAttribute("lang")).toBe(false);
    const tail = nameBlock.lastElementChild!;
    expect(tail.getAttribute("aria-hidden")).toBe("true");
    expect(tail.getAttribute("lang")).toBe("ko");
    expect(tail.textContent).toBe(" (경복궁 관훈점)");
    expect(nameBlock.textContent).toBe("Gyeongbokgung Gwanhunjeom (경복궁 관훈점)");
    // 버튼 이름(계산)에도 한글 이름이 섞이지 않는다.
    expect(screen.getByRole("button").textContent?.includes("경복궁 관훈점 (")).toBe(false);
  });

  it("en: 로마자가 없으면 한글 그대로 + lang=ko(A26 상태 불변)", () => {
    renderCard("en", { ...base, name: "경복궁 관훈점" });
    const nameBlock = screen.getByText("경복궁 관훈점").closest("span.block")!;
    expect(nameBlock.getAttribute("lang")).toBe("ko");
    expect(nameBlock.querySelector("[aria-hidden]")).toBeNull();
  });

  it("ko: nameRoman이 있어도 화면은 종전과 같다", () => {
    renderCard("ko", { ...base, name: "경복궁 관훈점", nameRoman: "Gyeongbokgung Gwanhunjeom" });
    const nameBlock = screen.getByText("경복궁 관훈점").closest("span.block")!;
    expect(nameBlock.textContent).toBe("경복궁 관훈점");
    expect(nameBlock.querySelector("[aria-hidden]")).toBeNull();
    expect(screen.queryByText(/Gyeongbokgung/)).toBeNull();
  });
});

describe("AddressResultList 병기(R2 버튼 안)", () => {
  const addr = {
    roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
    roadAddrPart1: "서울특별시 강동구 성내로 12",
    jibunAddr: "서울특별시 강동구 성내동 1",
    engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul",
    zipNo: "05397",
    bdNm: "",
  };

  it("en: 영문 메인 한 줄에 한글 도로명이 aria-hidden 괄호로 붙고 보조 블록은 없다", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AddressResultList addresses={[addr]} onSelect={() => {}} />
      </NextIntlClientProvider>,
    );
    const main = screen.getByText("12 Seongnae-ro, Gangdong-gu, Seoul", { exact: false }).closest("span.block")!;
    expect(accessibleText(main)).toBe("12 Seongnae-ro, Gangdong-gu, Seoul");
    expect(main.lastElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(main.textContent).toBe("12 Seongnae-ro, Gangdong-gu, Seoul (서울특별시 강동구 성내로 12 (성내동))");
    // 종전 보조 블록(한글 도로명이 SR에 낭독되던 자리)은 사라졌다 — 한글 도로명은 hidden 괄호 안에만.
    expect(screen.queryByText(addr.roadAddr, { exact: true })).toBeNull();
    // 지번 줄은 라벨+값 한 텍스트(분절 없음).
    const jibun = screen.getByText(`Lot number ${addr.jibunAddr}`);
    expect(jibun.getAttribute("lang")).toBe("ko");
    expect(jibun.children.length).toBe(0);
  });

  it("ko: 한글 도로명 메인, 괄호 없음", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={ko}>
        <AddressResultList addresses={[addr]} onSelect={() => {}} />
      </NextIntlClientProvider>,
    );
    const main = screen.getByText(addr.roadAddr).closest("span.block")!;
    expect(main.querySelector("[aria-hidden]")).toBeNull();
    expect(main.getAttribute("lang")).toBe("ko");
  });
});
