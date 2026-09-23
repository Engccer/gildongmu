/**
 * 옛 위치(stale-origin) 판정과 시간 표현(순수 함수). Kit `StaleOrigin.swift` ↔ `:kit`
 * `StaleOrigin.kt` 미러, 공유 fixture `stale-fix-age-cases.json`.
 * 설계 정본 `docs/superpowers/specs/2026-09-23-stale-origin-disclosure-design.md`.
 */
import type { GeoState } from "./geolocation";
import type { Coord } from "./types";

export type StaleFixAge =
  | { unit: "justNow"; count: 0 }
  | { unit: "minutes"; count: number }
  | { unit: "hours"; count: number };

/**
 * 경과 초 → 표현. 1분 미만 `justNow`, 1~59분 `minutes`, 그 이상 `hours`(모두 내림).
 * 음수(시계 역행)는 0으로 접고, 비유한 값은 null — 시각을 모르면 옛 위치라고 말할 수 없다.
 */
export function staleFixAge(ageSeconds: number): StaleFixAge | null {
  if (!Number.isFinite(ageSeconds)) return null;
  const minutes = Math.floor(Math.max(0, ageSeconds) / 60);
  if (minutes < 1) return { unit: "justNow", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  return { unit: "hours", count: Math.floor(minutes / 60) };
}

/** 시간 표현을 고른 문구 키(`manualLocation` 네임스페이스, ICU plural 인자 `count`). */
export type StaleAgeMessage = {
  key: "staleAgeJustNow" | "staleAgeMinutes" | "staleAgeHours";
  count: number;
};

/** 측정 시각(epoch 초)과 지금(epoch ms) → 문구 키. 시각을 모르면 null. */
export function staleAgeMessage(fixedAtSec: number, nowMs: number): StaleAgeMessage | null {
  const age = staleFixAge(nowMs / 1000 - fixedAtSec);
  if (!age) return null;
  const key =
    age.unit === "justNow" ? "staleAgeJustNow" : age.unit === "minutes" ? "staleAgeMinutes" : "staleAgeHours";
  return { key, count: age.count };
}

/**
 * 옛 위치(spec 2026-09-23 stale-origin §2): 이번 측위가 취득 실패로 끝났고 측정 시각을
 * 아는 직전 좌표가 있으면 그 좌표, 아니면 null. 권한 거부·좌표 없음·시각 모름은 null이다
 * (시각을 밝히는 것이 판정의 내용이라 모르는 시각은 옛 위치가 아니다).
 */
export function staleFixOf(state: GeoState): (Coord & { at: number }) | null {
  if (state.status !== "denied" || state.reason === "denied" || !state.last) return null;
  const { at } = state.last;
  if (at == null || !Number.isFinite(at)) return null;
  return { ...state.last, at };
}
