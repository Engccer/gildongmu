/**
 * "내 주변" 계열 컴포넌트의 공통 계약 스위트 — 도메인 fixture만 주입하고 계약 자체는
 * 공유한다(스펙 §1). 9벌 복붙이 새 중복 축이 되는 것을 막는 것이 이 팩토리의 목적이다.
 *
 * 이 파일은 테스트 파일이 아니다(`.test.` 미포함 → vitest include 패턴에 안 잡힌다).
 * 각 `*.contract.test.tsx`가 preamble(jsdom 프라그마 + next-intl·geolocation mock)을
 * 선언한 뒤 `describeNearbyContract(config)`를 호출한다.
 *
 * ⚠ 이 계약은 **무수정 현행 컴포넌트**의 행동을 못 박는 판정자다. 이후 추출 태스크가
 * 이 파일을 함께 고치면 "green = 행동 불변"이 순환 논증이 되므로 수정 금지(유일 예외:
 * 스펙 §3 잠복 결함의 red→green 전이).
 *
 * mock 경계: `awaitGeolocation`(각 테스트 파일의 `vi.mock`)과 전역 `fetch`만.
 * `nearby-panel-store`·`isInKorea`는 실물 — 커버리지 선분기는 실좌표로 판정한다.
 */
import type { ReactElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import type { GeoState } from "@/lib/geolocation";

/** 서울시청 — `isInKorea` true. 숫자→문자열 변환이 자명한 값만 쓴다(URL 계약). */
export const KOREA_COORDS = { lat: 37.5665, lng: 126.978 };
/** 도쿄 — ready지만 `isInKorea` false(실좌표, mock 아님). */
export const OVERSEAS_COORDS = { lat: 35.6762, lng: 139.6503 };

/** 닫기 버튼 접근 가능한 이름 — 9종 공통 `tActions("close")`. */
const CLOSE_NAME = "actions.close";

/** 계약 스위트 설정 — 도메인 변이만 담는다(plan "대상 9종과 변이 좌표" 표가 출처). */
export interface NearbyContractConfig {
  /** describe 이름(컴포넌트명). */
  name: string;
  /** 무프롭 기본 렌더(홈/허브 문맥). */
  renderComponent: () => ReactElement;
  /** next-intl 네임스페이스 — live·헤딩 키 접두(mock이 `ns.key`를 돌려준다). */
  ns: string;
  /** 트리거 버튼의 접근 가능한 이름(idle 라벨, 보통 `${ns}.button`). */
  triggerName: string;
  /** fetch가 받아야 할 요청 URL 전량(쿼리 포함). */
  expectedUrl: (lat: number, lng: number) => string;
  /** done을 만드는 응답 body. */
  successBody: unknown;
  /** done 패널에 보여야 할 항목 텍스트 조각(도메인 렌더 검증). */
  successProbe: string;
  /** empty를 만드는 body(없으면 empty 계약 생략 — WalkInfra는 empty 개념 부재). */
  emptyBody?: unknown;
  /** outOfCoverage 계약 적용 여부(WalkInfra만 false). */
  hasCoverage: boolean;
  /**
   * done 시 live가 `${ns}.ready`인가. false면 팩토리는 "ready가 아님"만 확인하고
   * 실제 문자열(BusArrivals·WhereAmI의 빈 문자열, WalkInfra의 소스 합성)은 각
   * 테스트 파일이 고유 it으로 못 박는다 — 팩토리가 임의 값을 단정해 거짓 green을
   * 만들지 않기 위한 경계.
   */
  liveReadyOnDone: boolean;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const geoMock = vi.mocked(awaitGeolocation);

function readyAt(coords: { lat: number; lng: number }): GeoState {
  return { status: "ready", coords };
}

/** 컴포넌트가 읽는 표면(`ok`·`json()`)만 갖춘 최소 Response. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

/** 마이크로태스크 큐를 act 안에서 비운다(가드가 막았어야 할 후속 호출 확인용). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

export function describeNearbyContract(config: NearbyContractConfig) {
  const { ns } = config;
  const live = () => screen.getByRole("status").textContent;
  const heading = () => screen.queryByRole("heading", { level: 3 });

  describe(`${config.name} 공통 계약`, () => {
    let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

    beforeEach(() => {
      geoMock.mockReset();
      fetchMock = vi.fn<FetchFn>();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    function open() {
      const view = render(config.renderComponent());
      const trigger = screen.getByRole("button", { name: config.triggerName });
      return { ...view, trigger };
    }

    async function openToDone() {
      geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
      fetchMock.mockResolvedValue(jsonResponse(config.successBody));
      const view = open();
      fireEvent.click(view.trigger);
      await waitFor(() => expect(heading()).not.toBeNull());
      return view;
    }

    it("트리거를 누르면 결과 패널을 열고 헤딩으로 포커스를 옮기며 done을 통지한다", async () => {
      const { container } = await openToDone();

      expect(container.textContent).toContain(config.successProbe);
      expect(heading()!.textContent).toContain(`${ns}.ready`);
      expect(heading()!.textContent).toContain(`${ns}.asOf`);
      // 포커스 이동은 useEffect(패시브) — React의 플러시는 MessageChannel 매크로태스크라
      // waitFor 종료 드레인(setTimeout 0)보다 늦게 도착할 수 있다. 동기 단언은 부하가
      // 걸린 전체 스위트에서 간헐 red가 된다(실측) → 계약 8·10과 같은 waitFor로 통일.
      await waitFor(() => expect(document.activeElement).toBe(heading()));
      if (config.liveReadyOnDone) expect(live()).toBe(`${ns}.ready`);
      else expect(live()).not.toBe(`${ns}.ready`);
    });

    it("공유 스토어 좌표로 정해진 URL을 no-store로 한 번 호출한다", async () => {
      await openToDone();

      expect(geoMock).toHaveBeenCalledTimes(1);
      expect(geoMock).toHaveBeenCalledWith({ force: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        config.expectedUrl(KOREA_COORDS.lat, KOREA_COORDS.lng),
      );
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    });

    if (config.emptyBody !== undefined) {
      it("결과 0건이면 패널 없이 empty를 통지한다", async () => {
        geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
        fetchMock.mockResolvedValue(jsonResponse(config.emptyBody));
        const { container, trigger } = open();

        fireEvent.click(trigger);

        await waitFor(() => expect(live()).toBe(`${ns}.empty`));
        expect(heading()).toBeNull();
        expect(container.textContent).not.toContain(config.successProbe);
      });
    }

    it("조회 실패는 error로 통지하고 패널을 열지 않는다", async () => {
      geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
      fetchMock.mockResolvedValue(jsonResponse({}, false));
      const { trigger } = open();

      fireEvent.click(trigger);

      await waitFor(() => expect(live()).toBe(`${ns}.error`));
      expect(heading()).toBeNull();
    });

    it("위치 거부는 geoDenied로 통지한다", async () => {
      geoMock.mockResolvedValue({ status: "denied" });
      const { trigger } = open();

      fireEvent.click(trigger);

      await waitFor(() => expect(live()).toBe(`${ns}.geoDenied`));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("위치 미지원은 geoUnsupported로 통지한다", async () => {
      geoMock.mockResolvedValue({ status: "unsupported" });
      const { trigger } = open();

      fireEvent.click(trigger);

      await waitFor(() => expect(live()).toBe(`${ns}.geoUnsupported`));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    if (config.hasCoverage) {
      it("커버리지 밖 좌표는 upstream을 부르지 않고 커버리지 안내를 낸다", async () => {
        geoMock.mockResolvedValue(readyAt(OVERSEAS_COORDS));
        const { trigger } = open();

        fireEvent.click(trigger);

        await waitFor(() => expect(live()).toBe("common.outOfCoverage"));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(heading()).toBeNull();
      });

      it("서버 커버리지 마커 응답도 같은 안내로 수렴한다", async () => {
        geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
        fetchMock.mockResolvedValue(jsonResponse({ outOfCoverage: true }));
        const { trigger } = open();

        fireEvent.click(trigger);

        await waitFor(() => expect(live()).toBe("common.outOfCoverage"));
        expect(heading()).toBeNull();
      });
    }

    it("조회 중 재클릭은 중복 요청을 만들지 않는다", async () => {
      geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
      fetchMock.mockReturnValue(new Promise<Response>(() => {}));
      const { trigger } = open();

      fireEvent.click(trigger);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(live()).toBe(`${ns}.loading`);

      fireEvent.click(trigger);
      await flush();

      expect(geoMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("닫으면 패널을 접고 포커스를 트리거로 되돌린다", async () => {
      const { trigger } = await openToDone();

      fireEvent.click(screen.getByRole("button", { name: CLOSE_NAME }));

      expect(heading()).toBeNull();
      expect(live()).toBe("");
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it("새로고침 좌표 재취득이 실패해도 직전 결과를 잃지 않는다", async () => {
      geoMock
        .mockResolvedValueOnce(readyAt(KOREA_COORDS))
        .mockResolvedValueOnce({ status: "denied" });
      fetchMock.mockResolvedValue(jsonResponse(config.successBody));
      const { container, trigger } = open();

      fireEvent.click(trigger);
      await waitFor(() => expect(heading()).not.toBeNull());

      fireEvent.click(trigger);
      await waitFor(() => expect(geoMock).toHaveBeenCalledTimes(2));
      expect(geoMock).toHaveBeenLastCalledWith({ force: true });

      await waitFor(() => expect(heading()).not.toBeNull());
      expect(container.textContent).toContain(config.successProbe);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(live()).not.toBe(`${ns}.geoDenied`);
    });

    it("새로고침이 성공하면 결과 헤딩으로 다시 포커스를 옮긴다", async () => {
      geoMock.mockResolvedValue(readyAt(KOREA_COORDS));
      fetchMock.mockResolvedValue(jsonResponse(config.successBody));
      const { trigger } = open();

      fireEvent.click(trigger);
      await waitFor(() => expect(heading()).not.toBeNull());

      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      fireEvent.click(trigger);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(geoMock).toHaveBeenLastCalledWith({ force: true });

      await waitFor(() => expect(document.activeElement).toBe(heading()));
      expect(heading()).not.toBeNull();
    });
  });
}
