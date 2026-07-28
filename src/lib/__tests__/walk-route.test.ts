import { describe, expect, it } from "vitest";
import { annotateAudioSignals } from "../walk-route";
import seed from "../data/audio-signals.json";
import type { WalkRouteBriefing } from "../types";

const signals = (seed as unknown as { signals: [number, number][] }).signals;
const [sigLat, sigLng] = signals[0];
// 서울 안·신호기 원거리 점(2026-07-28 seed 실측 최근접 143m — seed 갱신 시 재확인)
const FAR = { lat: 37.53, lng: 126.995 };

function briefing(steps: WalkRouteBriefing["steps"]): WalkRouteBriefing {
  return { distanceMeters: 800, durationSeconds: 700, steps };
}

describe("annotateAudioSignals", () => {
  it("횡단보도 단계 + 40m 내 seed → 문장 끝 쉼표 주석", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "우측 횡단보도 후 11m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("우측 횡단보도 후 11m 이동, 음향신호기 있음");
  });

  it("횡단보도 단계지만 40m 밖 → 무주석(positive-only)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "횡단보도 후 20m 이동", coord: FAR }]),
    );
    expect(out.steps[0].description).toBe("횡단보도 후 20m 이동");
  });

  it("비횡단보도 단계는 seed 인접이어도 무주석(실측 오탐 클래스)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "직진 후 양재대로를 따라 2m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("직진 후 양재대로를 따라 2m 이동");
  });

  it("coord 없는 단계는 무주석", () => {
    const out = annotateAudioSignals(briefing([{ description: "횡단보도 후 이동" }]));
    expect(out.steps[0].description).toBe("횡단보도 후 이동");
  });

  it("모든 단계에서 coord를 제거한다(주석 여부 무관 — API 응답 노출 금지)", () => {
    const out = annotateAudioSignals(
      briefing([
        { description: "횡단보도 후 이동", coord: { lat: sigLat, lng: sigLng } },
        { description: "직진", coord: FAR },
      ]),
    );
    for (const s of out.steps) expect("coord" in s).toBe(false);
  });

  it("총 거리·시간은 그대로 통과한다", () => {
    const out = annotateAudioSignals(briefing([{ description: "직진" }]));
    expect(out.distanceMeters).toBe(800);
    expect(out.durationSeconds).toBe(700);
  });
});
