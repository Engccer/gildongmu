// @vitest-environment jsdom
import { vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import type { GeoState } from "@/lib/geolocation";
import { __resetNearbyPanelStore } from "@/lib/nearby-panel-store";
import { NightClinicsNearby } from "../NightClinicsNearby";
import { KidsPlacesNearby } from "../KidsPlacesNearby";
import { KOREA_COORDS } from "./nearby-contract";

/**
 * 교차 패널 회귀 게이트(스펙 §3) — 2026-07-30 수정된 잠복 결함의 재발 방지.
 *
 * 수정 전 결함: 패널 A(NightClinics) 조회 중 패널 B(KidsPlaces)가 claim해 A가
 * onDismiss(자동 닫힘)로 접혀도, A의 fetch는 dismiss를 모른 채 늦게 도착한 응답으로
 * setStatus(done)을 호출했다. A가 순간 재열려 포커스를 빼앗고, 자동 재닫힘이 포커스를
 * 쥔 헤딩을 DOM에서 제거해 포커스가 body로 이탈했다(재열림 자체는 자가교정으로 가려져
 * 마지막 단언(포커스 유지)만이 이 결함을 잡는다 — 그 단언을 절대 약화하지 말 것).
 * 수정: useNearbyFetch의 요청 ID latest-wins — close가 ID를 증가시켜 늦은 응답을
 * 반영 전에 폐기한다.
 *
 * 이 파일은 두 실물 컴포넌트 + 실물 nearby-panel-store로 그 실조건을 재현한다
 * (mock 경계는 nearby-contract.tsx와 동일 — awaitGeolocation과 전역 fetch만).
 * 결함 재현 이력은 git의 it.fails 시절 커밋(2b1f51c) 참조.
 */

const clinic = {
  id: "clinic-1",
  name: "서울아이병원",
  address: "서울 강동구 천호대로 1000",
  phone: "02-1234-5678",
  kind: "달빛어린이병원",
  emergencyClass: "응급의료기관 이외",
  directions: "",
  lat: 37.5385,
  lng: 127.1234,
  distanceMeters: 350,
  hours: [],
  openStatus: { state: "open", start: 1800, end: 2400 },
  designated: true,
};
const clinicsSuccessBody = { clinics: [clinic], basis: "weekday", supplementFailed: false };

const kidsPlace = {
  id: "kakao-1",
  name: "길동키즈카페",
  category: "가정,생활 > 유아용품 > 키즈카페",
  kind: "kidscafe",
  indoorOutdoor: "indoor",
  distanceMeters: 120,
  address: "서울 강동구 길동 1",
  roadAddress: "서울 강동구 양재대로 1",
  lat: 37.5385,
  lng: 127.1424,
  phone: "02-111-2222",
  link: "https://place.map.kakao.com/1",
};
const kidsSuccessBody = { kids: [kidsPlace] };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const geoMock = vi.mocked(awaitGeolocation);

function readyAt(coords: { lat: number; lng: number }): GeoState {
  return { status: "ready", coords };
}

/** 컴포넌트가 읽는 표면(`ok`·`json()`)만 갖춘 최소 Response(nearby-contract.tsx와 동형). */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

describe("nearby 교차 패널 결함 (NightClinics ↔ KidsPlaces)", () => {
  let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    __resetNearbyPanelStore();
    geoMock.mockReset();
    geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
    fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it(
    "패널 A 로딩 중 B를 열면 A의 늦은 응답이 폐기된다 — 닫힌 A가 재열리거나 포커스를 빼앗지 않는다",
    async () => {
      // A(NightClinics) fetch를 지연 프라미스로 보류 — 응답이 도착하기 전에 B가 claim한다.
      let resolveA!: (v: Response) => void;
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((r) => { resolveA = r; }),
      );
      render(
        <>
          <NightClinicsNearby />
          <KidsPlacesNearby />
        </>,
      );

      fireEvent.click(screen.getByRole("button", { name: "clinicNearby.button" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1); // A loading, 응답 보류 중

      // B 트리거 → claim이 A를 onDismiss(자동 닫힘, restoreFocus=false)로 접는다.
      fetchMock.mockResolvedValueOnce(jsonResponse(kidsSuccessBody));
      fireEvent.click(screen.getByRole("button", { name: "kidsNearby.button" }));
      await screen.findByText(/길동키즈카페/); // B done

      const bHeading = screen.getByRole("heading", { name: /kidsNearby\.ready/ });
      // 전제 조건: B 헤딩 포커스 안착. 포커스 이동은 패시브 useEffect라 동기 단언은
      // 부하에서 간헐 실패한다(waitFor 종료 드레인 setTimeout(0)과의 경합 — 계약
      // 팩토리 done 포커스 단언과 동일 원인·동일 수정). 아래 최종 단언(142행 판정)은
      // 안착 이후의 동기 검사라 그대로 둔다 — "포커스가 떠난 적 없음"이 계약이다.
      await waitFor(() => expect(document.activeElement).toBe(bHeading));

      // A의 늦은 응답이 이제야 도착한다 — dismiss된 A는 이 사실을 모른다.
      await act(async () => {
        resolveA(jsonResponse(clinicsSuccessBody));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // 계약: A 패널은 닫힌 채여야 하고(재열림 금지) 포커스는 B에 남아야 한다.
      expect(screen.queryByText(/서울아이병원/)).toBeNull();
      expect(document.activeElement).toBe(bHeading);
    },
  );
});
