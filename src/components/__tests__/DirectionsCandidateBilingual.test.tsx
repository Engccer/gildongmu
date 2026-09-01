// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JusoAddress, Place } from "@/lib/types";

/** 비-ko(en) 길찾기 후보 목록의 병기 계약(E28 후속) — 장소는 로마자, 주소는 juso 공식 영문. */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
vi.mock("../DistanceBeacon", () => ({ DistanceBeacon: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "강남역",
  nameRoman: "Gangnamyeok",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};

const juso: JusoAddress = {
  roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
  roadAddrPart1: "서울특별시 강동구 성내로 12",
  jibunAddr: "서울특별시 강동구 성내동 540",
  engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul",
  zipNo: "05397",
  bdNm: "",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function accessibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent ?? "";
}

describe("DirectionsView 후보 목록 병기(en)", () => {
  it("장소 후보는 로마자 이름 + 주소이고 한글 이름은 버튼 이름의 마지막 노드다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/places")) {
          return { ok: true, json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }) } as Response;
        }
        if (url.startsWith("/api/address/search")) {
          return { ok: true, json: async () => ({ addresses: [juso] }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    render(<DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("from"), { target: { value: "강남" } });
    fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));

    const placeButton = await waitFor(() =>
      screen.getByRole("button", { name: "Gangnamyeok, 서울 강남구 강남대로 396" }),
    );
    expect(accessibleText(placeButton)).toBe("Gangnamyeok, 서울 강남구 강남대로 396");
    const tail = placeButton.lastElementChild!;
    expect(tail.getAttribute("aria-hidden")).toBe("true");
    expect(tail.textContent).toBe(" (강남역)");
    expect(tail.nextSibling).toBeNull();
    // 주소가 한국어로 남아 접근 텍스트에 한글이 있으면 줄 전체 lang=ko(R4).
    expect(placeButton.getAttribute("lang")).toBe("ko");

    // 주소 후보: 공식 영문 주소가 1순위, 한글 도로명주소는 괄호, 접근 텍스트에 한글 없음 → lang 없음.
    const addrButton = screen.getByRole("button", { name: juso.engAddr });
    expect(accessibleText(addrButton)).toBe(juso.engAddr);
    expect(addrButton.lastElementChild?.textContent).toBe(` (${juso.roadAddr})`);
    expect(addrButton.getAttribute("lang")).toBeNull();
  });
});
