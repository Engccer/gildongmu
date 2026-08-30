// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 비-ko 로케일(en) — 합성 줄(이름·종별·거리)의 병기 자리 계약(E28 R1 줄 끝). */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => "en",
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { awaitGeolocation } from "@/lib/geolocation";
import { NightClinicsNearby } from "../NightClinicsNearby";
import { KOREA_COORDS } from "./nearby-contract";

const geoMock = vi.mocked(awaitGeolocation);

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const clinic = {
  id: "clinic-1",
  name: "서울아이병원",
  nameRoman: "Seouraibyeongwon",
  address: "서울 강동구 천호대로 1000",
  phone: "",
  kind: "달빛어린이병원",
  emergencyClass: "",
  directions: "",
  lat: 37.5385,
  lng: 127.1234,
  distanceMeters: 350,
  hours: [],
  openStatus: { state: "unknown", start: null, end: null },
};

describe("NightClinicsNearby 병기(en, 합성 줄)", () => {
  beforeEach(() => {
    geoMock.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ clinics: [clinic, { ...clinic, id: "c2", name: "CU 병원", nameRoman: "CU Byeongwon" }], basis: "weekday", supplementFailed: false })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("h4는 로마자 이름으로 시작하고 한글은 줄 끝 aria-hidden 괄호, lang은 접근 텍스트 기준", async () => {
    geoMock.mockResolvedValue({ status: "ready", coords: KOREA_COORDS });
    render(<NightClinicsNearby />);
    fireEvent.click(screen.getByRole("button", { name: "clinicNearby.button" }));
    const headings = await waitFor(() => screen.getAllByRole("heading", { level: 4 }));
    const h4 = headings[0];
    // 접근 텍스트(hidden 제외)는 로마자 이름 + 종별(한국어 잔존) + 거리 — 한글 이름은 없다.
    const clone = h4.cloneNode(true) as Element;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    expect(clone.textContent?.startsWith("Seouraibyeongwon, 달빛어린이병원, ")).toBe(true);
    expect(clone.textContent?.includes("서울아이병원")).toBe(false);
    // 괄호는 헤딩의 마지막 자식(R1 — 가운데 두면 텍스트 노드가 갈린다).
    const tail = h4.lastElementChild!;
    expect(tail.getAttribute("aria-hidden")).toBe("true");
    expect(tail.getAttribute("lang")).toBe("ko");
    expect(tail.textContent).toBe(" (서울아이병원)");
    expect(tail.nextSibling).toBeNull();
    // 종별이 한국어라 줄 전체 lang=ko 유지(A26 혼합 줄 축).
    expect(h4.getAttribute("lang")).toBe("ko");
    // 두 번째 항목: 로마자에 한글이 없고 이름 원문 "CU 병원"은 한글을 품어 병기 대상.
    expect(headings[1].textContent).toContain("CU Byeongwon, 달빛어린이병원");
    expect(headings[1].textContent?.endsWith(" (CU 병원)")).toBe(true);
  });
});
