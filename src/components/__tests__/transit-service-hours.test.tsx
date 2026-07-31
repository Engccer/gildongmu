// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { TransitRouteResult } from "../TransitRouteBriefing";
import messages from "../../../messages/ko.json";

// TransitRouteResult는 t를 prop으로 받으므로 provider 안쪽 컴포넌트에서 훅으로 만들어 넘긴다
function Harness({ leg }: { leg: Record<string, unknown> }) {
  const t = useTranslations("route.transit");
  const route = {
    summary: {
      totalMinutes: 22,
      fare: 1500,
      transfers: 0,
      walkMinutes: 5,
      arriveName: "목적지",
    },
    legs: [leg],
  };
  return <TransitRouteResult route={route as never} t={t} locale="ko" dest="목적지" />;
}

function renderLeg(leg: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <Harness leg={leg} />
    </NextIntlClientProvider>,
  );
}

// vitest 전역 자동 cleanup이 없어 렌더가 누적된다(PlaceDetail.test.tsx 관례)
afterEach(cleanup);

describe("운행 시간 낭독", () => {
  it("outside면 첫차·막차와 미운행 문구를 같은 항목에 이어 붙인다", () => {
    renderLeg({
      mode: "bus",
      lineName: "342",
      fromName: "강동역",
      toName: "길동생태공원",
      stationCount: 14,
      minutes: 22,
      serviceStatus: "outside",
      firstServiceTime: "04:00",
      lastServiceTime: "22:30",
    });
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("첫차 04:00");
    expect(item.textContent).toContain("지금은 운행하지 않습니다");
    // 한 줄 = 한 접근성 객체: 운행 문구가 순수 텍스트로 붙어야 한다.
    // 요소 노드는 기존 고유명 span 2개(승차 정류장·노선)뿐이고 늘어나면 안 된다.
    // t()를 t.rich로 바꾸거나 강조 span을 넣는 변이를 이 단언이 잡는다.
    expect(item.querySelectorAll("*")).toHaveLength(2);
  });

  it("running이면 아무 문구도 붙이지 않는다(정상은 침묵)", () => {
    renderLeg({
      mode: "bus",
      lineName: "N30",
      fromName: "강동역",
      toName: "천호역",
      stationCount: 4,
      minutes: 10,
      serviceStatus: "running",
      firstServiceTime: "23:10",
      lastServiceTime: "03:50",
    });
    expect(screen.getByRole("listitem").textContent).not.toContain("첫차");
  });

  it("unknown이면 아무 문구도 붙이지 않는다(정보 없음 반복 낭독 금지)", () => {
    renderLeg({
      mode: "bus",
      lineName: "141",
      fromName: "서면",
      toName: "해운대",
      stationCount: 10,
      minutes: 30,
      serviceStatus: "unknown",
    });
    expect(screen.getByRole("listitem").textContent).not.toContain("첫차");
  });
});
