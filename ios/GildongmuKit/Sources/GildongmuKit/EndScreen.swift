import Foundation

// ── 안내 종료 화면의 수명(A31 축 ②, spec 2026-09-02 §3) ──
// 웹 `src/lib/end-screen.ts` 미러. 공유 fixture `end-screen-stale-cases.json`이 동조 강제.
// 백그라운드에서 끝난 세션의 종료 화면은 정지 톤도 음성도 없이 화면 하나만 남고(설계대로 — 주머니 속
// 폰이 갑자기 울리지 않게), 그 화면엔 수명도 시각 표기도 없어 8시간 전 종료가 "방금 종료"로 읽혔다.

/// 종료 뒤 이만큼(초) 지나 **백그라운드를 거쳐** 전경으로 돌아오면 화면과 미뤄진 종료 통지를 버린다.
/// 앱 유휴 리셋(10분)보다 넉넉해 "잠깐 다른 앱" 사용을 자르지 않는다. 전경 체류 중엔 판정하지 않는다.
public let endScreenStaleSeconds = 1800.0

/// 경과는 잠자기 중에도 전진하는 단조 시계(`ContinuousClock`)로 잰다 — `systemUptime`은 잠자기 동안 멈춰
/// "주머니에 8시간"이 0분이 되고, 벽시계는 앞으로 교정되면 1분 된 새 화면을 30분 지난 것으로 읽는다.
/// 음수·NaN·무한은 소거하지 않는다(근거 없는 소거 금지 — 종료 화면은 걸음 요약의 유일한 채널이다).
public func isEndScreenStale(secondsSinceEnd: Double) -> Bool {
    secondsSinceEnd.isFinite && secondsSinceEnd >= endScreenStaleSeconds
}
