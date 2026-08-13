// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { presumedArrivalStep } from "../final-approach";

/**
 * 실사고 리플레이 게이트(spec 2026-08-13 §6). 17:03 KST 귀가 세션 —
 * finalApproachEnter(08:08:31Z) 직후 usable fix 0건이 되며 세션이 잊혔다.
 * 이 타임라인에 판정을 재생해 "마지막 fix + 180초에 noFix 발동, 그 전엔 침묵"을
 * 회귀 기준으로 잠근다. 거리 입력은 진입 fix의 perp(42.6m)를 근사로 쓴다
 * (목적지 좌표는 로그에 없다 — 최종 접근 진입 직후라 직선거리와 대차 없음).
 */
const LOG = path.join(
  process.cwd(),
  "docs/superpowers/specs/logs/guide-diag-2026-08-13.log.gz",
);

interface Entry {
  t: number;
  event: string;
}

function parseSession(): Entry[] {
  const lines = gunzipSync(readFileSync(LOG)).toString("utf8").split("\n");
  const out: Entry[] = [];
  for (const line of lines) {
    if (!line.includes("[2026-08-13T08:0")) continue;
    const t = /fix t=([0-9.]+)/.exec(line);
    const ev = /event=([a-zA-Z-]+)/.exec(line);
    if (t) out.push({ t: Number(t[1]), event: ev?.[1] ?? "-" });
  }
  return out;
}

describe("도착 추정 리플레이 (2026-08-13 실사고)", () => {
  const fixes = parseSession();
  const entered = fixes.find((f) => f.event === "finalApproachEnter");
  const last = fixes[fixes.length - 1];
  const ENTRY_PERP_M = 42.6;

  it("세션이 기대 모양이다 (최종 접근 진입 = 마지막 fix)", () => {
    expect(fixes.length).toBeGreaterThan(200);
    expect(entered).toBeDefined();
    expect(last.t).toBe(entered!.t);
  });

  it("fix 스트림 생존 중에는 발동하지 않는다", () => {
    for (const f of fixes) {
      expect(
        presumedArrivalStep({
          inFinalApproach: f.event === "finalApproachEnter",
          secondsSinceUsableFix: 0,
          secondsSinceProgress: 0,
          lastKnownDistanceToDestMeters: ENTRY_PERP_M,
        }),
      ).toBeNull();
    }
  });

  it("마지막 fix + 180초에 noFix 발동, 그 전엔 침묵 (2초 워치독 틱 재생)", () => {
    const lastT = last.t;
    for (let tick = lastT; tick < lastT + 179; tick += 2) {
      expect(
        presumedArrivalStep({
          inFinalApproach: true,
          secondsSinceUsableFix: tick - lastT,
          secondsSinceProgress: tick - lastT,
          lastKnownDistanceToDestMeters: ENTRY_PERP_M,
        }),
      ).toBeNull();
    }
    expect(
      presumedArrivalStep({
        inFinalApproach: true,
        secondsSinceUsableFix: 180,
        secondsSinceProgress: 180,
        lastKnownDistanceToDestMeters: ENTRY_PERP_M,
      }),
    ).toBe("noFix");
  });
});
