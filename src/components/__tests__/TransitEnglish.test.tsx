// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import type { SubwayArrival, TransitLeg, TransitRoute } from "@/lib/types";
import { SubwayArrivalList } from "../SubwayArrivalList";
import { TransitRouteResult } from "../TransitRouteBriefing";
import { arrivalItems } from "@/lib/place-lines/station-arrivals";
import { pickLine } from "@/lib/place-lines/pick-line";

vi.mock("@/hooks/useAxisBridge", () => ({ useAxisSource: () => {} }));

// vitest globals 없이 RTL은 자동 cleanup을 안 한다 — 앞 렌더의 li가 다음 테스트에 남는다.
afterEach(cleanup);

/**
 * E27 §3.6 — en 계열 로케일의 대중교통 표시: 줄 단위 원자성(영문이 모자란 줄은 통째로 한국어 + lang="ko"),
 * 병기(괄호 한글은 aria-hidden·lang="ko"), 비-en 로케일의 영어 줄 lang="en".
 */
function wrap(locale: "en" | "ja", ui: ReactNode) {
  const messages = locale === "en" ? en : ja;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ARRIVAL_EN: SubwayArrival = {
  line: "2호선",
  lineEn: "Line 2",
  direction: "외선",
  directionEn: "Outer Circle",
  trainLineNm: "성수행 - 역삼방면",
  trainLineNmEn: "To Seongsu via Yeoksam",
  destination: "성수",
  message: "2분 30초 후",
  messageEn: "In 2 min 30 sec",
  currentLocation: "선릉",
  currentLocationEn: "Seolleung",
  arrivalSeconds: 150,
  express: false,
};

describe("SubwayArrivalList — en 로케일", () => {
  it("영문이 다 있으면 두 줄이 영어이고 lang 속성이 없다(en 로케일)", () => {
    const { container } = wrap("en", <SubwayArrivalList arrivals={[ARRIVAL_EN]} />);
    const divs = container.querySelectorAll("li div");
    expect(divs[0].textContent).toBe("Line 2 Outer Circle, To Seongsu via Yeoksam");
    expect(divs[0].getAttribute("lang")).toBeNull();
    expect(divs[1].textContent).toBe("In 2 min 30 sec, Now at Seolleung");
    expect(divs[1].getAttribute("lang")).toBeNull();
  });

  it("영문 조각 하나가 없으면 그 줄만 통째로 한국어 + lang=ko(줄 단위 원자성)", () => {
    const partial: SubwayArrival = { ...ARRIVAL_EN, trainLineNmEn: undefined, currentLocationEn: undefined };
    const { container } = wrap("en", <SubwayArrivalList arrivals={[partial]} />);
    const divs = container.querySelectorAll("li div");
    expect(divs[0].textContent).toBe("2호선 외선, 성수행 - 역삼방면");
    expect(divs[0].getAttribute("lang")).toBe("ko");
    // 현재역 영문이 없으면 메시지 줄도 한국어 원문 — 값이 한국어인 줄은 라벨이 섞여도 통째로 lang=ko(A26 선례)
    expect(divs[1].textContent).toBe("2분 30초 후, Now at 선릉");
    expect(divs[1].getAttribute("lang")).toBe("ko");
  });

  it("현재역·노선이 애초에 없는 도착은 그 자리를 요구하지 않는다 — 영문이 있으면 영어 줄(a11y 감사 #1)", () => {
    const noExtras: SubwayArrival = {
      ...ARRIVAL_EN,
      line: undefined,
      lineEn: undefined,
      currentLocation: undefined,
      currentLocationEn: undefined,
      message: "전역 도착",
      messageEn: "Arrived at previous station",
    };
    const { container } = wrap("en", <SubwayArrivalList arrivals={[noExtras]} />);
    const divs = container.querySelectorAll("li div");
    expect(divs[0].textContent).toBe("Outer Circle, To Seongsu via Yeoksam");
    expect(divs[0].getAttribute("lang")).toBeNull();
    expect(divs[1].textContent).toBe("Arrived at previous station");
    expect(divs[1].getAttribute("lang")).toBeNull();
  });

  it("ja 로케일의 순수 데이터 영어 줄은 lang=en(일본어 음성이 영문을 읽지 않게), 혼합 줄은 무태그", () => {
    const { container } = wrap("ja", <SubwayArrivalList arrivals={[ARRIVAL_EN]} />);
    const divs = container.querySelectorAll("li div");
    expect(divs[0].getAttribute("lang")).toBe("en");
    // 메시지 줄은 UI 템플릿(現在位置 …)이 섞여 태그하지 않는다
    expect(divs[1].getAttribute("lang")).toBeNull();
  });

  it("ko 로케일 항목 모양은 종전과 같다(lang 키 없음)", () => {
    const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}${JSON.stringify(v)}` : k);
    const items = arrivalItems([ARRIVAL_EN], t);
    expect(items[0]).toEqual({
      line: "2호선 외선, 성수행 - 역삼방면",
      direction: "외선",
      message: '2분 30초 후, currentLocation{"location":"선릉"}',
      state: { kind: "ok" },
    });
  });
});

describe("TransitRouteResult — en 로케일 구간 문장", () => {
  const legs: TransitLeg[] = [
    { mode: "walk", minutes: 3, toName: "길동", toNameEn: "Gildong", distanceMeters: 98 },
    {
      mode: "subway",
      lineName: "수도권 9호선(급행)",
      lineNameEn: "Line 9 Express",
      fromName: "김포공항",
      fromNameEn: "Gimpo Int'l Airport",
      toName: "신논현",
      toNameEn: "Sinnonhyeon",
      stationCount: 9,
      minutes: 30,
    },
    { mode: "bus", lineName: "서초03", lineNameEn: "Seocho03", fromName: "강남역", toName: "역삼역", stationCount: 2, minutes: 5 },
  ];
  const route: TransitRoute = {
    summary: { totalMinutes: 40, fare: 1650, transfers: 1, walkMinutes: 3, departName: "김포공항", arriveName: "역삼역", departNameEn: "Gimpo Int'l Airport", arriveNameEn: "Yeoksam Station" },
    legs,
    routeKey: "p0",
  };
  const t = Object.assign(
    (key: string, values?: Record<string, unknown>) => {
      const template = (en.route.transit as Record<string, string>)[key];
      return values ? template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? "")) : template;
    },
    {
      rich: (key: string, values: Record<string, (chunks: ReactNode) => ReactNode>) => {
        const template = (en.route.transit as Record<string, string>)[key];
        const out: ReactNode[] = [];
        const re = /<(\w+)><\/\1>|\{(\w+)\}/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(template))) {
          out.push(template.slice(last, m.index));
          const name = m[1] ?? m[2];
          const fn = values[name];
          out.push(typeof fn === "function" ? fn("") : String(fn));
          last = m.index + m[0].length;
        }
        out.push(template.slice(last));
        return <>{out.map((n, i) => <span key={i}>{n}</span>)}</>;
      },
    },
  ) as unknown as Parameters<typeof TransitRouteResult>[0]["t"];

  function renderRoute() {
    return wrap("en", <TransitRouteResult route={route} t={t} locale="en" dest="Yeoksam" />);
  }

  it("노선·승차역이 둘 다 영문인 지하철 구간은 영어 문장 + 승차역 괄호 병기(aria-hidden·lang=ko)", () => {
    const { container } = renderRoute();
    const li = container.querySelectorAll("li")[1];
    expect(li.textContent).toBe("Board Line 9 Express at Gimpo Int'l Airport (김포공항), 9 stops");
    const hidden = li.querySelector('[aria-hidden="true"]');
    expect(hidden?.getAttribute("lang")).toBe("ko");
    expect(hidden?.textContent).toBe(" (김포공항)");
    expect(li.querySelectorAll("span[lang='ko']:not([aria-hidden])")).toHaveLength(0);
    expect(container.querySelector("ol")).toBeTruthy();
  });

  it("승차역 영문이 없는 버스 구간은 한국어 원문 + lang=ko(줄 단위 원자성 — 영문 번호만으로 영어 문장을 만들지 않는다)", () => {
    const { container } = renderRoute();
    const li = container.querySelectorAll("li")[2];
    expect(li.textContent).toBe("Transfer to bus 서초03 at 강남역, 2 stops");
    const marked = [...li.querySelectorAll("[lang]")].map((e) => e.textContent);
    expect(marked).toEqual(["강남역"]);
  });

  it("도보 행선지는 영문(문장 틀 자리라 병기 없음)", () => {
    const { container } = renderRoute();
    expect(container.querySelectorAll("li")[0].textContent).toBe("Walk 3 min to Gildong, 98m");
  });

  it("도착 문단은 하차역 영문 + 괄호 병기", () => {
    const { container } = renderRoute();
    const arrive = container.querySelector("p.mt-1.text-sm:last-of-type");
    expect(arrive?.textContent).toBe("Arrive at Yeoksam Station (역삼역)");
  });
});

describe("pickLine", () => {
  it("ko 로케일은 항상 한국어(태그 없음)", () => {
    expect(pickLine("ko", "강남", ["Gangnam"], ([e]) => e)).toEqual({ text: "강남" });
  });
  it("en 로케일 영문 완비 → 영어(en은 무태그), ja는 lang=en", () => {
    expect(pickLine("en", "강남", ["Gangnam"], ([e]) => e)).toEqual({ text: "Gangnam" });
    expect(pickLine("ja", "강남", ["Gangnam"], ([e]) => e)).toEqual({ text: "Gangnam", lang: "en" });
    expect(pickLine("ja", "강남 2호선", ["Gangnam", "Line 2"], (p) => p.join(" "), { pure: false })).toEqual({ text: "Gangnam Line 2" });
  });
  it("결측(undefined)은 한국어 + lang=ko(혼합 줄도), 빈 문자열은 자리 표시라 영어 줄이 된다", () => {
    expect(pickLine("en", "강남 2호선", ["Gangnam", undefined], (p) => p.join(" "))).toEqual({ text: "강남 2호선", lang: "ko" });
    expect(pickLine("en", "강남 2호선", ["Gangnam", null], (p) => p.join(" "), { pure: false })).toEqual({ text: "강남 2호선", lang: "ko" });
    expect(pickLine("en", "강남", ["Gangnam", ""], (p) => p.filter(Boolean).join(" "))).toEqual({ text: "Gangnam" });
  });
});
