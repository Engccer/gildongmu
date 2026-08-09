import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({ hasKakaoKey: vi.fn(() => true) }));
vi.mock("@/lib/surroundings-scene", () => ({ assembleScene: vi.fn() }));

import { GET } from "../route";
import { hasKakaoKey } from "@/lib/env";
import { assembleScene } from "@/lib/surroundings-scene";

const mockHasKey = vi.mocked(hasKakaoKey);
const mockAssemble = vi.mocked(assembleScene);

const req = (qs: string) =>
  new NextRequest(`http://x/api/surroundings/scene${qs}`);

beforeEach(() => {
  mockHasKey.mockReset();
  mockHasKey.mockReturnValue(true);
  mockAssemble.mockReset();
});

describe("GET /api/surroundings/scene", () => {
  it("좌표 누락은 400 — (0,0)으로 흘려보내지 않는다", async () => {
    const res = await GET(req("?lng=127.0"));
    expect(res.status).toBe(400);
  });

  it("한국 밖은 200 outOfCoverage (upstream 미호출)", async () => {
    const res = await GET(req("?lat=48.85&lng=2.35"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(mockAssemble).not.toHaveBeenCalled();
  });

  it("키가 없으면 data null", async () => {
    mockHasKey.mockReturnValue(false);
    const res = await GET(req("?lat=37.5415&lng=127.1495"));
    expect(await res.json()).toEqual({ data: null });
  });

  it("조립 실패는 502 — 0건과 구분한다", async () => {
    mockAssemble.mockRejectedValue(new Error("upstream"));
    const res = await GET(req("?lat=37.5415&lng=127.1495"));
    expect(res.status).toBe(502);
  });

  it("정상은 장면을 그대로 싣는다", async () => {
    mockAssemble.mockResolvedValue({
      place: "성내로 25",
      frame: "entrance",
      groups: [],
      total: 0,
    });
    const res = await GET(req("?lat=37.5415&lng=127.1495"));
    expect((await res.json()).data.frame).toBe("entrance");
  });
});
