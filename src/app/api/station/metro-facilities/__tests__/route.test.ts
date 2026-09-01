import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SeoulMetroFacilities } from "@/lib/types";

vi.mock("@/lib/providers/seoul-metro-facilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/seoul-metro-facilities")>()),
  fetchSeoulMetroFacilities: vi.fn(),
}));

import { GET } from "../route";
import { fetchSeoulMetroFacilities } from "@/lib/providers/seoul-metro-facilities";

const req = (q: Record<string, string>) =>
  new NextRequest(`http://x/api/station/metro-facilities?${new URLSearchParams(q)}`);

const base = { location: undefined, floors: undefined, operatingStatus: undefined, detail: undefined };

/** 환승역 음성유도기 2건(5호선·표 밖 노선) + 노선 없는 엘리베이터 1건. */
const FOUND: SeoulMetroFacilities = {
  stationName: "천호",
  line: "5호선",
  groups: [
    {
      kind: "elevator",
      facilities: [{ ...base, name: "승강기)엘리베이터-천호 1호기", location: "1번 출구" }],
    },
    {
      kind: "voiceGuide",
      facilities: [
        { ...base, name: "3번 출구 5호선", parts: { location: "3번 출구", line: "5" } },
        { ...base, name: "7번 출구 99호선", parts: { location: "7번 출구", line: "99" } },
      ],
    },
  ],
};

/**
 * E27 잔여 — `lang`. 미지정·ko는 byte-identical, en은 `parts.lineEn`만 additive, 표 미스는 부재, 미지 값 400.
 */
describe("GET /api/station/metro-facilities — lang", () => {
  it("ko·미지정은 동일 본문이고 lineEn이 없다", async () => {
    vi.mocked(fetchSeoulMetroFacilities).mockResolvedValue(FOUND);
    const ko = await (await GET(req({ station: "천호역" }))).json();
    const ko2 = await (await GET(req({ station: "천호역", lang: "ko" }))).json();
    expect(JSON.stringify(ko2)).toBe(JSON.stringify(ko));
    expect(JSON.stringify(ko)).toBe(JSON.stringify({ facilities: FOUND }));
    expect(JSON.stringify(ko)).not.toContain("lineEn");
  });

  it("en은 표에 있는 노선만 parts.lineEn을 싣고 나머지 필드는 불변", async () => {
    vi.mocked(fetchSeoulMetroFacilities).mockResolvedValue(FOUND);
    const en = (await (await GET(req({ station: "천호역", lang: "en" }))).json()) as {
      facilities: SeoulMetroFacilities;
    };
    const guides = en.facilities.groups[1].facilities;
    expect(guides[0].parts).toEqual({ location: "3번 출구", line: "5", lineEn: "Line 5" });
    expect(guides[0].name).toBe("3번 출구 5호선");
    // 표 미스는 부재(거짓 영문보다 부재) — 소비자는 종전 조립으로 떨어진다.
    expect(guides[1].parts).toEqual({ location: "7번 출구", line: "99" });
    // 노선 없는 그룹은 손대지 않는다.
    expect(en.facilities.groups[0]).toEqual(FOUND.groups[0]);
    // 입력을 변형하지 않는다(en 투영이 provider 반환값을 건드리면 같은 프로세스의 ko 응답이 오염된다).
    expect(FOUND.groups[1].facilities[0].parts).not.toHaveProperty("lineEn");
  });

  it("미커버 역은 en에서도 facilities:null", async () => {
    vi.mocked(fetchSeoulMetroFacilities).mockResolvedValue(null);
    const en = await (await GET(req({ station: "없는역", lang: "en" }))).json();
    expect(en.facilities).toBeNull();
  });

  it("미지 lang은 400", async () => {
    expect((await GET(req({ station: "천호역", lang: "jp" }))).status).toBe(400);
  });
});
