// E70-b D6 — 여정 조회의 진입점 하나(`queryJourney`): 선판정 순서와 「소진 상태에서 유료 호출 0」.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../rate-limit", () => ({
  journeyTmapExhausted: vi.fn(() => false),
  journeyIpExhausted: vi.fn(() => false),
  chargeJourneyIp: vi.fn(() => true),
  reserveJourneyTmap: vi.fn(() => "ok"),
}));

import { queryJourney } from "../query";
import type { JourneyDeps, JourneyRequest } from "../assemble";
import { chargeJourneyIp, journeyIpExhausted, journeyTmapExhausted } from "../../rate-limit";

const FROM = { lat: 37.5559, lng: 126.9723 };
const TO = { lat: 37.5716, lng: 126.9764 };
const AHYEON = { name: "아현역", coord: { lat: 37.5574, lng: 126.9561 } };
const REQ: JourneyRequest = { from: FROM, to: TO, board: AHYEON };

function spyDeps() {
  const deps: JourneyDeps = {
    // 후보 없음 → 여정은 `variants: []`로 끝난다(Tmap 예약까지 가지 않는다).
    candidates: vi.fn(async () => null),
    car: vi.fn(),
    exits: vi.fn(),
    stands: vi.fn(),
  };
  return deps;
}

describe("queryJourney — 여정 조회 진입점(E70-b D6)", () => {
  beforeEach(() => {
    vi.mocked(journeyTmapExhausted).mockReturnValue(false);
    vi.mocked(journeyIpExhausted).mockReturnValue(false);
    vi.mocked(chargeJourneyIp).mockClear();
    vi.mocked(chargeJourneyIp).mockReturnValue(true);
  });

  it("선판정을 통과하면 getJourney로 조회한다", async () => {
    const deps = spyDeps();
    expect(await queryJourney(REQ, "1.2.3.4", deps)).toEqual({ kind: "ok", result: { variants: [] } });
    expect(deps.candidates).toHaveBeenCalled();
  });

  it("일 상한이 소진됐으면 budgetExhausted이고 ODsay(candidates) 호출 0", async () => {
    vi.mocked(journeyTmapExhausted).mockReturnValue(true);
    const deps = spyDeps();
    expect(await queryJourney(REQ, "1.2.3.4", deps)).toEqual({ kind: "budgetExhausted" });
    expect(deps.candidates).not.toHaveBeenCalled();
    expect(deps.car).not.toHaveBeenCalled();
  });

  it("IP 버킷이 찼으면 rateLimited이고 ODsay(candidates) 호출 0", async () => {
    vi.mocked(journeyIpExhausted).mockReturnValue(true);
    const deps = spyDeps();
    expect(await queryJourney(REQ, "1.2.3.4", deps)).toEqual({ kind: "rateLimited" });
    expect(deps.candidates).not.toHaveBeenCalled();
  });

  it("일 상한 소진이 IP 버킷 소진보다 먼저다(라우트의 종전 순서)", async () => {
    vi.mocked(journeyTmapExhausted).mockReturnValue(true);
    vi.mocked(journeyIpExhausted).mockReturnValue(true);
    expect(await queryJourney(REQ, "1.2.3.4", spyDeps())).toEqual({ kind: "budgetExhausted" });
  });

  it("aboard는 조회 전에 IP 칸을 쓰고, 칸이 없으면 rateLimited이며 조회하지 않는다", async () => {
    const aboard: JourneyRequest = { from: FROM, to: TO, board: { ...AHYEON, line: "2호선", kind: "aboard", direction: "내선" } };
    const deps = spyDeps();
    await queryJourney(aboard, "1.2.3.4", deps);
    expect(chargeJourneyIp).toHaveBeenCalledTimes(1);
    expect(deps.candidates).toHaveBeenCalled();

    vi.mocked(chargeJourneyIp).mockReturnValue(false);
    const blocked = spyDeps();
    expect(await queryJourney(aboard, "1.2.3.4", blocked)).toEqual({ kind: "rateLimited" });
    expect(blocked.candidates).not.toHaveBeenCalled();
  });

  it("aboard가 아닌 요청은 요청 단위 IP 칸을 쓰지 않는다", async () => {
    await queryJourney(REQ, "1.2.3.4", spyDeps());
    expect(chargeJourneyIp).not.toHaveBeenCalled();
  });
});

describe("소스 가드 — 예약 밖 Tmap 호출 0(진입점은 하나)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("라우트와 채팅 도구는 getJourney·예약 함수를 직접 부르지 않고 queryJourney만 지난다", () => {
    for (const rel of ["src/app/api/route/journey/route.ts", "src/lib/chat/journey-tool.ts", "src/lib/chat/router.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\bgetJourney\s*\(/);
      expect(src, rel).not.toMatch(/\breserveJourneyTmap\b/);
      expect(src, rel).not.toMatch(/journey\/assemble["']/);
    }
    expect(read("src/app/api/route/journey/route.ts")).toMatch(/\bqueryJourney\s*\(/);
    expect(read("src/lib/chat/journey-tool.ts")).toMatch(/\bqueryJourney\s*\(/);
  });
});
