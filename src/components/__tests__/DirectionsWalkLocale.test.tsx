// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Place } from "@/lib/types";
import enMessages from "../../../messages/en.json";
import koMessages from "../../../messages/ko.json";

/**
 * 비-ko 도보 상세 안내 게이트 해제(E16 축3, spec 2026-08-23-non-ko-walk-guidance-design §4.7).
 *
 * 종전에는 도보 수단이 `!prefersEnglish(locale)` 뒤에 있어 en 사용자에게 **조회 자체가
 * 없었다**. 그 게이트는 provider 계약(문장이 한국어) 때문이었고, 서버가 en 문장을 만들면서
 * 사라졌다. 반대로 **계단 회피 토글은 남는다** — Tmap에 검증된 회피 축이 없어 항상
 * unavailable이라, 켤 수 있게 두면 SR 사용자가 적용됐다고 믿는다.
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => <p>walk steps</p> }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "Gangnam Station",
  category: "subway",
  address: "858 Yeoksam-dong, Gangnam-gu, Seoul",
  roadAddress: "396 Gangnam-daero, Gangnam-gu, Seoul",
  lat: 37.497,
  lng: 127.027,
};

const WALK_EN = {
  result: {
    distanceMeters: 900,
    durationSeconds: 20 * 60,
    steps: [{ description: "Turn right, then walk 294m along Gangnam-daero" }],
  },
};

let walkUrls: string[] = [];

function stubFetch() {
  walkUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({ places: [gangnam], provider: "kakao-local", query: "q" }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses: [] }) } as Response;
      }
      if (url.startsWith("/api/route/walk")) {
        walkUrls.push(url);
        return { ok: true, json: async () => WALK_EN } as Response;
      }
      if (url.startsWith("/api/route/transit")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (url.startsWith("/api/transit/track")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function stubGeolocationApi() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
}

async function queryRoutes(locale: "ko" | "en") {
  stubGeolocationApi();
  const messages = locale === "ko" ? koMessages : enMessages;
  const label = (key: "from" | "to" | "fromSearch" | "toSearch" | "submit") =>
    ({
      from: locale === "ko" ? "출발지" : "From",
      to: locale === "ko" ? "도착지" : "To",
      fromSearch: locale === "ko" ? "출발지 검색" : "Search starting point",
      toSearch: locale === "ko" ? "도착지 검색" : "Search destination",
      submit: locale === "ko" ? "경로 조회" : "Get routes",
    })[key];

  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DirectionsView canShowWalk canShowTransit canBriefCarRoute={false} onBack={() => {}} />
    </NextIntlClientProvider>,
  );

  for (const [field, button] of [
    [label("from"), label("fromSearch")],
    [label("to"), label("toSearch")],
  ] as const) {
    fireEvent.change(screen.getByLabelText(field), { target: { value: "gangnam" } });
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("Gangnam Station");
    });
    fireEvent.click(document.activeElement as HTMLElement);
  }
  fireEvent.click(screen.getByRole("button", { name: label("submit") }));
  await waitFor(() => expect(walkUrls.length).toBeGreaterThan(0));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("비-ko 도보 상세 (E16 축3)", () => {
  it("en 로케일에서도 도보를 조회하고 lang=en을 붙인다", async () => {
    stubFetch();
    await queryRoutes("en");
    expect(walkUrls.some((u) => u.includes("lang=en"))).toBe(true);
  });

  it("ko 로케일은 lang 파라미터를 붙이지 않는다(기존 캐시 키 유지)", async () => {
    stubFetch();
    await queryRoutes("ko");
    expect(walkUrls.every((u) => !u.includes("lang="))).toBe(true);
  });

  it("en 로케일에는 계단 회피 토글이 없다 — 적용될 수 없는 옵션을 노출하지 않는다", async () => {
    stubFetch();
    await queryRoutes("en");
    await waitFor(() => expect(screen.queryByText("walk steps")).not.toBeNull());
    expect(screen.queryByRole("button", { name: enMessages.route.pedestrian.stepFreeToggle })).toBeNull();
  });

  it("ko 로케일에는 계단 회피 토글이 그대로 있다", async () => {
    stubFetch();
    await queryRoutes("ko");
    await waitFor(() => expect(screen.queryByText("walk steps")).not.toBeNull());
    expect(screen.queryByRole("button", { name: koMessages.route.pedestrian.stepFreeToggle })).not.toBeNull();
  });
});
