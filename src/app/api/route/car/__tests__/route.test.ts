import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  // hasKakaoKey는 이 라우트가 더 이상 직접 참조하지 않지만, env 모듈 전체를
  // 모킹하므로 다른 공유 import가 undefined 호출 오류를 내지 않도록 유지한다.
  hasKakaoKey: vi.fn(() => true),
  hasCarRouteKey: vi.fn(() => true),
  hasNcpMapsKeys: vi.fn(() => false),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkCarRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/car-route", () => ({
  getCarRoute: vi.fn(async () => ({
    distanceMeters: 1000,
    durationSeconds: 300,
    steps: [{ description: "직진 후 우회전" }],
  })),
}));
vi.mock("@/lib/providers/ncp-directions", () => ({
  getCarRouteBriefingEn: vi.fn(async () => ({
    distanceMeters: 1000,
    durationSeconds: 300,
    steps: [{ description: "Turn right" }],
  })),
}));

import { GET } from "../route";
import { hasCarRouteKey, hasNcpMapsKeys } from "@/lib/env";
import { checkCarRateLimit } from "@/lib/rate-limit";
import { getCarRoute } from "@/lib/car-route";

function makeRequest(
  origin: string,
  dest: string,
  lang?: string,
  includeGeometry?: string,
) {
  const params = new URLSearchParams({ origin, dest });
  if (lang !== undefined) params.set("lang", lang);
  if (includeGeometry !== undefined) params.set("includeGeometry", includeGeometry);
  return new NextRequest(`http://x/api/route/car?${params.toString()}`);
}

describe("GET /api/route/car", () => {
  beforeEach(() => {
    vi.mocked(hasCarRouteKey).mockReturnValue(true);
    vi.mocked(hasNcpMapsKeys).mockReturnValue(false);
    vi.mocked(checkCarRateLimit).mockReturnValue(true);
    vi.mocked(getCarRoute).mockClear();
  });

  it("origin 형식 오류 → 400", async () => {
    const res = await GET(makeRequest("not-a-coord", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("출발지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
    const res = await GET(makeRequest("37.7749,-122.4194", "37.5665,126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("목적지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
    const res = await GET(makeRequest("37.5665,126.978", "37.7749,-122.4194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("전지구 범위 밖 좌표는 여전히 400(형식 오류와 커버리지 마커는 별개)", async () => {
    const res = await GET(makeRequest("95,200", "37.6,127.1"));
    expect(res.status).toBe(400);
  });

  it("정상 경로 → briefing 그대로 반환", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      distanceMeters: 1000,
      durationSeconds: 300,
      steps: [{ description: "직진 후 우회전" }],
      guidanceLang: "ko",
    });
  });

  describe("안내문 언어 마커 guidanceLang(A26 — ko 폴백은 N4의 의도된 결정, 마커로 정직화)", () => {
    it("lang=en + NCP 키 → en(NCP 영문 턴바이턴)", async () => {
      vi.mocked(hasNcpMapsKeys).mockReturnValue(true);
      const body = await (await GET(makeRequest("37.5,127.0", "37.6,127.1", "en"))).json();
      expect(body.guidanceLang).toBe("en");
      expect(getCarRoute).not.toHaveBeenCalled();
    });

    it("lang=en인데 NCP 키가 없으면 ko 서비스 폴백 + guidanceLang=ko", async () => {
      const body = await (await GET(makeRequest("37.5,127.0", "37.6,127.1", "en"))).json();
      expect(body.guidanceLang).toBe("ko");
      expect(getCarRoute).toHaveBeenCalledTimes(1);
    });

    it("lang=en + includeGeometry=1은 NCP가 기하를 못 주므로 ko 서비스 + guidanceLang=ko(실시간 안내 상세 유지)", async () => {
      vi.mocked(hasNcpMapsKeys).mockReturnValue(true);
      const body = await (await GET(makeRequest("37.5,127.0", "37.6,127.1", "en", "1"))).json();
      expect(body.guidanceLang).toBe("ko");
      expect(getCarRoute).toHaveBeenCalledWith(expect.objectContaining({ includeGeometry: true }));
    });

    it("lang=en + via(경유지)는 NCP 미검증이라 ko 서비스 + guidanceLang=ko", async () => {
      vi.mocked(hasNcpMapsKeys).mockReturnValue(true);
      const res = await GET(
        new NextRequest("http://x/api/route/car?origin=37.5,127.0&dest=37.6,127.1&via=37.55,127.05&lang=en"),
      );
      expect((await res.json()).guidanceLang).toBe("ko");
    });
  });

  it("경로 탐색 실패(provider 메시지)는 502 + code=noRoute — 소비자는 code로 문장을 고른다", async () => {
    vi.mocked(getCarRoute).mockRejectedValueOnce(new Error("경로 탐색 실패: result_code 104"));
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("noRoute");
  });

  it("includeGeometry=1은 서비스에 옵트인으로 전달된다", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1", undefined, "1"));
    expect(res.status).toBe(200);
    expect(getCarRoute).toHaveBeenCalledWith(
      expect.objectContaining({ includeGeometry: true }),
    );
  });

  it("includeGeometry 미지정은 옵트인 false로 전달된다(byte-호환 계약)", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(200);
    expect(getCarRoute).toHaveBeenCalledWith(
      expect.objectContaining({ includeGeometry: false }),
    );
  });

  it("includeGeometry가 1이 아닌 값이면 400(조용한 무시 금지 — walk 동형)", async () => {
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1", undefined, "true"));
    expect(res.status).toBe(400);
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("키 없음(hasCarRouteKey false, lang 미지정)은 503", async () => {
    vi.mocked(hasCarRouteKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(503);
  });

  it("키 없음 + 한국 밖 좌표는 커버리지 마커가 우선(503 아니라 200 outOfCoverage)", async () => {
    vi.mocked(hasCarRouteKey).mockReturnValue(false);
    const res = await GET(makeRequest("37.7749,-122.4194", "37.5665,126.978"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  it("provider throw → 502", async () => {
    vi.mocked(getCarRoute).mockRejectedValueOnce(new Error("fail"));
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(502);
  });

  it("레이트리밋 초과 → 429", async () => {
    vi.mocked(checkCarRateLimit).mockReturnValue(false);
    const res = await GET(makeRequest("37.5,127.0", "37.6,127.1"));
    expect(res.status).toBe(429);
    expect(getCarRoute).not.toHaveBeenCalled();
  });

  describe("via 경유지(N4)", () => {
    it("경유지가 한국 밖이면 200 outOfCoverage(provider 미호출)", async () => {
      const res = await GET(new NextRequest("http://x/api/route/car?origin=37.5,127.0&dest=37.6,127.1&via=37.7749,-122.4194"));
      expect(await res.json()).toEqual({ outOfCoverage: true });
      expect(getCarRoute).not.toHaveBeenCalled();
    });

    it("via는 서비스까지 전달된다", async () => {
      await GET(new NextRequest("http://x/api/route/car?origin=37.5,127.0&dest=37.6,127.1&via=37.55,127.05"));
      expect(vi.mocked(getCarRoute).mock.lastCall?.[0]).toMatchObject({ via: { lat: 37.55, lng: 127.05 } });
    });

    it("via 형식 오류는 400", async () => {
      const res = await GET(new NextRequest("http://x/api/route/car?origin=37.5,127.0&dest=37.6,127.1&via=x"));
      expect(res.status).toBe(400);
    });

    it("lang=en + via는 NCP가 아니라 ko 서비스로 간다(경유지를 조용히 버리지 않는다)", async () => {
      vi.mocked(hasNcpMapsKeys).mockReturnValue(true);
      await GET(new NextRequest("http://x/api/route/car?origin=37.5,127.0&dest=37.6,127.1&via=37.55,127.05&lang=en"));
      expect(vi.mocked(getCarRoute).mock.lastCall?.[0]).toMatchObject({ via: { lat: 37.55, lng: 127.05 } });
    });
  });
});
