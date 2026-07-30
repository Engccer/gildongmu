// @vitest-environment jsdom
import { vi } from "vitest";

vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { awaitGeolocation } from "@/lib/geolocation";
import type { GeoState } from "@/lib/geolocation";
import {
  __resetNearbyPanelStore,
  getActiveNearbyPanel,
} from "@/lib/nearby-panel-store";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import type { NearbySource } from "@/hooks/useNearbyFetch";

/**
 * `useNearbyFetch` 단위 계약 — 9종이 공유할 상태 머신의 정본을 훅 단독으로 못 박는다.
 * 컴포넌트 계약(`nearby-contract.tsx`)이 "화면에 무엇이 보이는가"를 검증한다면, 이
 * 파일은 그 아래의 요청 수명(요청 ID latest-wins·in-flight 잠금)을 검증한다 — 지연
 * 프라미스로 응답 도착 시점을 직접 통제해야만 드러나는 계약이라 컴포넌트 레벨에서는
 * 재현이 어렵다.
 *
 * mock 경계는 계약 테스트와 동일하게 `awaitGeolocation` 하나뿐이다. `nearby-panel-store`·
 * `isInKorea`는 실물이고, fetch는 전역 대신 훅 프롭 `fetchAt`으로 주입한다(URL 조립은
 * 도메인 몫이라 훅의 계약이 아니다).
 */

/** 서울시청 — `isInKorea` true(실좌표). */
const KOREA = { lat: 37.5665, lng: 126.978 };
/** 도쿄 — ready지만 `isInKorea` false(실좌표, mock 아님). */
const OVERSEAS = { lat: 35.6762, lng: 139.6503 };

type FetchAt = (coords: { lat: number; lng: number }) => Promise<Response>;

const geoMock = vi.mocked(awaitGeolocation);

function readyAt(coords: { lat: number; lng: number }): GeoState {
  return { status: "ready", coords };
}

/** 훅이 읽는 표면(`ok`·`json()`)만 갖춘 최소 Response(nearby-contract.tsx와 동형). */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

/** 해소 시점을 테스트가 쥐는 프라미스 — 응답 도착 순서를 직접 편성한다. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 마이크로태스크 큐를 act 안에서 전부 비운다(await 체인 3단까지 한 번에 정착). */
async function flush() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

const successBody = { items: ["A"] };

/** 도메인 parse의 최소판 — 빈 배열은 empty, 그 외는 done. */
function parseItems(body: unknown) {
  const items = (body as { items?: string[] }).items ?? [];
  return items.length > 0
    ? ({ kind: "done", data: items } as const)
    : ({ kind: "empty" } as const);
}

function setup(options?: {
  source?: NearbySource;
  coverage?: "korea" | "none";
  fetchAt?: FetchAt;
  onClose?: () => void;
}) {
  // 렌더마다 새 객체가 되지 않도록 클로저에 고정한다(참조 동일성이 흔들리면
  // 훅 내부 파생값의 재계산 여부가 테스트마다 달라진다).
  const source: NearbySource = options?.source ?? { kind: "current" };
  const fetchAt = vi.fn<FetchAt>(
    options?.fetchAt ?? (() => Promise.resolve(jsonResponse(successBody))),
  );
  const view = renderHook(() =>
    useNearbyFetch<string[]>({
      source,
      coverage: options?.coverage,
      fetchAt,
      parse: parseItems,
      onClose: options?.onClose,
    }),
  );
  return { ...view, fetchAt };
}

describe("useNearbyFetch", () => {
  beforeEach(() => {
    __resetNearbyPanelStore();
    geoMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("ⓐ 현재 위치 성공 경로는 idle→locating→loading→done으로 전이한다", async () => {
    const geo = deferred<GeoState>();
    geoMock.mockReturnValue(geo.promise);
    const res = deferred<Response>();
    const { result, fetchAt } = setup({ fetchAt: () => res.promise });

    expect(result.current.status.kind).toBe("idle");
    expect(result.current.busy).toBe(false);

    act(() => {
      result.current.load();
    });
    expect(result.current.status.kind).toBe("locating");
    expect(result.current.busy).toBe(true);
    expect(fetchAt).not.toHaveBeenCalled();

    geo.resolve(readyAt(KOREA));
    await flush();
    expect(result.current.status.kind).toBe("loading");
    expect(result.current.busy).toBe(true);
    expect(geoMock).toHaveBeenCalledWith({ force: false });
    expect(fetchAt).toHaveBeenCalledTimes(1);
    expect(fetchAt).toHaveBeenCalledWith(KOREA);

    res.resolve(jsonResponse(successBody));
    await flush();
    const status = result.current.status;
    expect(status.kind).toBe("done");
    if (status.kind === "done") {
      expect(status.data).toEqual(["A"]);
      expect(status.at).not.toBe("");
    }
    expect(result.current.doneSeq).toBe(1);
    expect(result.current.busy).toBe(false);
  });

  it("ⓑ place 소스는 위치 취득 없이 props 좌표로 곧장 조회한다", async () => {
    const { result, fetchAt } = setup({
      source: { kind: "place", lat: 37.5385, lng: 127.1424 },
    });

    act(() => {
      result.current.load();
    });
    // locating 단계 자체가 없다 — 곧장 loading.
    expect(result.current.status.kind).toBe("loading");

    await flush();
    expect(geoMock).not.toHaveBeenCalled();
    expect(fetchAt).toHaveBeenCalledWith({ lat: 37.5385, lng: 127.1424 });
    expect(result.current.status.kind).toBe("done");
    // place는 아코디언에 불참한다(상세의 단일 패널).
    expect(getActiveNearbyPanel()).toBeNull();
  });

  it("ⓒ 커버리지 밖 좌표는 upstream을 부르지 않고 outOfCoverage로 정착한다", async () => {
    geoMock.mockResolvedValue(readyAt(OVERSEAS));
    const { result, fetchAt } = setup();

    act(() => {
      result.current.load();
    });
    await flush();

    expect(result.current.status.kind).toBe("outOfCoverage");
    expect(fetchAt).not.toHaveBeenCalled();
  });

  it("ⓒ 서버 커버리지 마커 응답도 같은 상태로 수렴한다", async () => {
    geoMock.mockResolvedValue(readyAt(KOREA));
    const { result } = setup({
      fetchAt: () => Promise.resolve(jsonResponse({ outOfCoverage: true })),
    });

    act(() => {
      result.current.load();
    });
    await flush();

    expect(result.current.status.kind).toBe("outOfCoverage");
    expect(result.current.doneSeq).toBe(0);
  });

  it('ⓒ coverage:"none"은 해외 좌표를 그대로 조회하고 마커도 해석하지 않는다', async () => {
    geoMock.mockResolvedValue(readyAt(OVERSEAS));
    const { result, fetchAt } = setup({
      coverage: "none",
      fetchAt: () =>
        Promise.resolve(jsonResponse({ outOfCoverage: true, items: ["A"] })),
    });

    act(() => {
      result.current.load();
    });
    await flush();

    expect(fetchAt).toHaveBeenCalledWith(OVERSEAS);
    expect(result.current.status).toMatchObject({ kind: "done", data: ["A"] });
  });

  it("ⓓ 닫은 뒤 도착한 응답은 폐기된다 — idle을 유지한다(검사지점 ②)", async () => {
    geoMock.mockResolvedValue(readyAt(KOREA));
    const res = deferred<Response>();
    const onClose = vi.fn();
    const { result } = setup({ fetchAt: () => res.promise, onClose });

    act(() => {
      result.current.load();
    });
    await flush();
    expect(result.current.status.kind).toBe("loading");

    act(() => {
      result.current.close();
    });
    expect(result.current.status.kind).toBe("idle");
    expect(onClose).toHaveBeenCalledTimes(1);

    res.resolve(jsonResponse(successBody));
    await flush();

    // 닫힌 패널이 늦은 응답으로 되살아나지 않는다.
    expect(result.current.status.kind).toBe("idle");
    expect(result.current.doneSeq).toBe(0);
  });

  it("ⓔ 닫은 직후 재로드할 수 있고, 이전 요청의 해제가 새 요청의 잠금을 풀지 않는다", async () => {
    geoMock.mockResolvedValue(readyAt(KOREA));
    const first = deferred<Response>();
    const second = deferred<Response>();
    const { result, fetchAt } = setup({ fetchAt: () => first.promise });
    fetchAt
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => {
      result.current.load();
    });
    await flush();
    expect(fetchAt).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.close();
    });
    // 잠금이 boolean이었다면 close 직후의 재로드는 여전히 가능하지만, 아래에서
    // 이전 요청이 그 잠금을 풀어 버린다.
    act(() => {
      result.current.load();
    });
    await flush();
    expect(fetchAt).toHaveBeenCalledTimes(2);
    expect(result.current.status.kind).toBe("loading");

    // 폐기된 1번 요청이 이제야 도착한다.
    first.resolve(jsonResponse({ items: ["STALE"] }));
    await flush();
    expect(result.current.status.kind).toBe("loading"); // 상태 미반영
    expect(result.current.doneSeq).toBe(0);

    // 잠금 유지의 판정 — 1번의 unlock이 2번의 잠금을 풀었다면 여기서 3번째
    // 요청이 나간다(boolean 잠금의 회귀).
    act(() => {
      result.current.load();
    });
    await flush();
    expect(fetchAt).toHaveBeenCalledTimes(2);

    // 2번 요청만이 상태를 커밋한다(latest-wins).
    second.resolve(jsonResponse({ items: ["FRESH"] }));
    await flush();
    expect(result.current.status).toMatchObject({
      kind: "done",
      data: ["FRESH"],
    });
    expect(result.current.doneSeq).toBe(1);
  });

  it("ⓕ 새로고침(force) 좌표 재취득이 실패하면 직전 done 결과를 복원한다", async () => {
    geoMock
      .mockResolvedValueOnce(readyAt(KOREA))
      .mockResolvedValueOnce({ status: "denied" });
    const { result, fetchAt } = setup();

    act(() => {
      result.current.load();
    });
    await flush();
    expect(result.current.status.kind).toBe("done");

    act(() => {
      result.current.load(true);
    });
    await flush();

    expect(geoMock).toHaveBeenLastCalledWith({ force: true });
    expect(result.current.status).toMatchObject({ kind: "done", data: ["A"] });
    expect(fetchAt).toHaveBeenCalledTimes(1); // 재조회 없이 직전 결과 유지
    expect(result.current.doneSeq).toBe(1);
  });

  it("ⓖ 닫힌 요청의 위치 실패는 직전 결과를 되살리지 않는다", async () => {
    const refresh = deferred<GeoState>();
    geoMock
      .mockResolvedValueOnce(readyAt(KOREA))
      .mockReturnValueOnce(refresh.promise);
    const { result } = setup();

    act(() => {
      result.current.load();
    });
    await flush();
    expect(result.current.status.kind).toBe("done");

    act(() => {
      result.current.load(true); // prevStatus = done, 좌표는 보류 중
    });
    expect(result.current.status.kind).toBe("locating");

    act(() => {
      result.current.close();
    });
    expect(result.current.status.kind).toBe("idle");

    refresh.resolve({ status: "denied" });
    await flush();

    // done 복원도(닫힌 패널 부활), geoerror 통지도 아니다 — 아무것도 반영하지 않는다.
    expect(result.current.status.kind).toBe("idle");
  });

  it("ⓖ 닫힌 요청의 좌표로는 upstream을 호출하지 않는다(검사지점 ①)", async () => {
    const geo = deferred<GeoState>();
    geoMock.mockReturnValue(geo.promise);
    const { result, fetchAt } = setup();

    act(() => {
      result.current.load();
    });
    expect(result.current.status.kind).toBe("locating");

    act(() => {
      result.current.close();
    });

    geo.resolve(readyAt(KOREA));
    await flush();
    expect(fetchAt).not.toHaveBeenCalled();
    expect(result.current.status.kind).toBe("idle");

    // 그 경로도 잠금은 해제한다 — 이어지는 재로드가 막히지 않는다.
    act(() => {
      result.current.load();
    });
    await flush();
    expect(fetchAt).toHaveBeenCalledTimes(1);
    expect(result.current.status.kind).toBe("done");
  });

  it("ⓗ autoLoad 소스는 마운트 시 1회만 자동 로드한다", async () => {
    geoMock.mockResolvedValue(readyAt(KOREA));
    const { result, rerender, fetchAt } = setup({
      source: { kind: "current", autoLoad: true },
    });

    await flush();
    expect(result.current.status.kind).toBe("done");
    expect(geoMock).toHaveBeenCalledTimes(1);
    expect(fetchAt).toHaveBeenCalledTimes(1);
    // 채팅 카드는 아코디언에 불참한다 — 다른 패널을 닫지 않는다.
    expect(getActiveNearbyPanel()).toBeNull();

    rerender();
    await flush();
    expect(fetchAt).toHaveBeenCalledTimes(1);
  });
});
