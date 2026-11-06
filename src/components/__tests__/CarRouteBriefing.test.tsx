// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { CarRouteBriefing as Briefing } from "@/lib/types";
import { CarRouteBriefing, CarRouteResult } from "../CarRouteBriefing";
import messages from "../../../messages/ko.json";
import en from "../../../messages/en.json";

/**
 * 자동차 브리핑 카드 계약(A26): ① 오류 낭독은 서버의 한국어 `error` 문자열이 아니라 HTTP
 * status·`code`로 고른 `t()` 문장이다(`useVoiceRecorder` 선례) ② 서버가 ko로 폴백한 안내문
 * (`guidanceLang: "ko"`)은 스텝 줄에 `lang="ko"`를 달아 en 페이지에서도 한국어 엔진으로 읽힌다.
 */

vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({
    status: "ready" as const,
    coords: { lat: 37.538, lng: 127.139 },
  })),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BRIEFING: Briefing = {
  distanceMeters: 3200,
  durationSeconds: 600,
  taxiFare: 6800,
  tollFare: 0,
  guides: [
    { name: "천호대로", guidance: "천호대로를 따라 1.2km 직진", distanceMeters: 1200, durationSeconds: 120 },
    { name: "", guidance: "올림픽로로 우회전", distanceMeters: 0, durationSeconds: 0 },
  ],
};

function Harness({ briefing }: { briefing: Briefing }) {
  const t = useTranslations("route.briefing");
  return <CarRouteResult briefing={briefing} locale="en" t={t} />;
}

function renderResult(briefing: Briefing) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Harness briefing={briefing} />
    </NextIntlClientProvider>,
  );
}

describe("안내문 언어 마커 → 스텝 줄 lang", () => {
  it("guidanceLang=ko면 각 스텝 <li>에 lang=\"ko\"(별도 줄이라 분절 없음)", () => {
    renderResult({ ...BRIEFING, guidanceLang: "ko" });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const li of items) {
      expect(li.getAttribute("lang")).toBe("ko");
      expect(li.querySelectorAll("*")).toHaveLength(0);
    }
  });

  it("guidanceLang=en이거나 없으면 lang을 달지 않는다", () => {
    renderResult({ ...BRIEFING, guidanceLang: "en" });
    for (const li of screen.getAllByRole("listitem")) expect(li.hasAttribute("lang")).toBe(false);
    cleanup();
    renderResult(BRIEFING);
    for (const li of screen.getAllByRole("listitem")) expect(li.hasAttribute("lang")).toBe(false);
  });
});

describe("오류 낭독은 서버 문자열이 아니라 t() 문장", () => {
  async function requestWith(status: number, body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: status < 400, status, json: async () => body })),
    );
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <CarRouteBriefing dest={{ lat: 37.555, lng: 126.972, name: "서울역" }} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: messages.route.briefing.button }));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(""));
    return screen.getByRole("status").textContent;
  }

  it("503(키 없음)은 서버 한국어 문장 대신 notConfigured", async () => {
    const text = await requestWith(503, { error: "경로 브리핑은 API 키 등록 후 사용할 수 있습니다." });
    expect(text).toBe(messages.route.briefing.notConfigured);
  });

  it("429는 rateLimited", async () => {
    const text = await requestWith(429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
    expect(text).toBe(messages.route.briefing.rateLimited);
  });

  it("502 + code=noRoute는 noRoute", async () => {
    const text = await requestWith(502, { error: "경로를 찾지 못했습니다.", code: "noRoute" });
    expect(text).toBe(messages.route.briefing.noRoute);
  });

  it("그 밖의 실패는 일반 오류 문장(서버 문자열 무시)", async () => {
    const text = await requestWith(502, { error: "서버가 보낸 임의의 한국어 문장" });
    expect(text).toBe(messages.route.briefing.error);
  });
});

describe("정체 한 줄(E80 §4 — 요약 뒤 한 접근성 객체, 3-state)", () => {
  const jam = (startMeters: number, lengthMeters: number, road: string | null) => ({
    road,
    startMeters,
    lengthMeters,
    start: { lat: 37.5, lng: 127 },
    end: { lat: 37.5, lng: 127.01 },
  });
  function renderKo(briefing: Briefing) {
    function H() {
      const t = useTranslations("route.briefing");
      return <CarRouteResult briefing={briefing} locale="ko" t={t} />;
    }
    return render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <H />
      </NextIntlClientProvider>,
    );
  }

  it("정체가 있으면 요약 바로 뒤 <p> 하나, 자식 요소 없음", () => {
    const { container } = renderKo({ ...BRIEFING, congestion: { jams: [jam(7400, 1100, "올림픽대로"), jam(10500, 600, null)] } });
    const ps = [...container.querySelectorAll("p")];
    const line = ps[1];
    expect(line.textContent).toBe("막히는 구간 2곳: 7.4km 가서 올림픽대로 1.1km, 10.5km 가서 600m.");
    expect(line.querySelectorAll("*")).toHaveLength(0);
  });

  it("정체 없음은 그렇다고 말하고, 정보 없음(null)·미요청은 줄이 없다", () => {
    const none = renderKo({ ...BRIEFING, congestion: { jams: [] } });
    expect(none.container.textContent).toContain("막히는 구간이 없습니다.");
    cleanup();
    const unknown = renderKo({ ...BRIEFING, congestion: null });
    expect(unknown.container.textContent).not.toContain("막히는 구간");
    cleanup();
    const absent = renderKo(BRIEFING);
    expect(absent.container.textContent).not.toContain("막히는 구간");
  });

  it("en 화면은 한글 도로 이름을 싣지 않는다", () => {
    const { container } = renderResult({ ...BRIEFING, congestion: { jams: [jam(7400, 1100, "올림픽대로")] } });
    expect(container.textContent).toContain("1 congested stretch: 1.1km starting in 7.4km.");
    expect(container.textContent).not.toContain("올림픽대로");
  });
});
