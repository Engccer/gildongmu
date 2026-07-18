import Foundation

/// 유휴 복귀 초기화 판정 — 웹 `src/lib/idle-reset.ts` 미러(계약 정본은 웹).
/// 백그라운드 진입 시각으로부터 임계를 초과해 복귀하면 세션을 초기 화면으로
/// 재생성한다. 순수 함수만(뷰·서비스 비의존).
/// 스펙: docs/superpowers/specs/2026-07-18-idle-reset-title-refresh-design.md
public enum IdleReset {
    /// 10분(웹 IDLE_RESET_MS 미러).
    public static let interval: TimeInterval = 10 * 60

    /// 기록 없음(백그라운드 미경유) → 리셋 안 함. 미래 시각(시계 역행) →
    /// 경과가 음수라 리셋 안 함(편의 기능이라 보수적으로). 초과만 리셋(경계 제외).
    public static func shouldReset(backgroundedAt: Date?, now: Date) -> Bool {
        guard let backgroundedAt else { return false }
        return now.timeIntervalSince(backgroundedAt) > interval
    }
}
