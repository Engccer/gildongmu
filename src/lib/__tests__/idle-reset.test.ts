import { describe, expect, it } from "vitest";
import {
  IDLE_RESET_MS,
  shouldIdleReset,
  shouldResetOnMount,
} from "@/lib/idle-reset";

describe("shouldIdleReset", () => {
  const now = 1_800_000_000_000;

  it("기록이 없으면(첫 방문·공유 링크) 리셋하지 않는다", () => {
    expect(shouldIdleReset(null, now)).toBe(false);
  });

  it("임계 이내 복귀는 리셋하지 않는다", () => {
    expect(shouldIdleReset(String(now - IDLE_RESET_MS + 1), now)).toBe(false);
  });

  it("정확히 임계 경과는 리셋하지 않는다(초과만 리셋)", () => {
    expect(shouldIdleReset(String(now - IDLE_RESET_MS), now)).toBe(false);
  });

  it("임계 초과면 리셋한다", () => {
    expect(shouldIdleReset(String(now - IDLE_RESET_MS - 1), now)).toBe(true);
  });

  it("미래 타임스탬프(시계 역행)는 리셋하지 않는다", () => {
    expect(shouldIdleReset(String(now + 60_000), now)).toBe(false);
  });

  it("숫자가 아닌 손상 값은 리셋하지 않는다", () => {
    expect(shouldIdleReset("corrupted", now)).toBe(false);
    expect(shouldIdleReset("", now)).toBe(false);
  });
});

describe("shouldResetOnMount", () => {
  const now = 1_800_000_000_000;
  const stale = String(now - IDLE_RESET_MS - 1);

  it("standalone 콜드 재시작이 ?q=를 복원했으면 리셋한다", () => {
    expect(shouldResetOnMount(stale, now, "?q=이태원커피", true)).toBe(true);
  });

  it("브라우저 탭 진입(비-standalone)은 stale이어도 리셋하지 않는다 — 재방문자 공유 링크 보존", () => {
    expect(shouldResetOnMount(stale, now, "?q=이태원커피", false)).toBe(false);
  });

  it("?q= 없는 로드는 이미 초기 화면이라 리셋하지 않는다", () => {
    expect(shouldResetOnMount(stale, now, "", true)).toBe(false);
  });

  it("기록이 없으면(첫 방문) 리셋하지 않는다", () => {
    expect(shouldResetOnMount(null, now, "?q=카페", true)).toBe(false);
  });

  it("임계 이내면 리셋하지 않는다", () => {
    expect(shouldResetOnMount(String(now - 1000), now, "?q=카페", true)).toBe(false);
  });
});
