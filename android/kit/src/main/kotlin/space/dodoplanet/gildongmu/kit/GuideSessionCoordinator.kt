package space.dodoplanet.gildongmu.kit

/**
 * 실시간 길 안내 세션 단일성 코디네이터(B2 §3.2) — 웹 `guide-session-store` 동형, Kit `GuideSessionCoordinator.swift` 미러.
 *
 * 도보·자동차와 대중교통이 서로 다른 모델 인스턴스라, 앱 수준 객체가 상호 배제를 든다. 플랫폼당 활성 안내
 * 세션은 최대 1개다: 통지 채널이 2벌 돌면 통지가 겹치고 위치 구독이 이중 과금된다.
 *
 * **정책(N1, 2026-08-22 반전)**: 다른 소유자가 있으면 `claim`은 **거부(null)**한다. 종전엔 기존 세션을
 * 동기 중지하고 새 세션을 받았는데, 세션이 탭과 분리되어 다른 탭에서 조회하다 시작 버튼을 누르는 경로가
 * 생기자 "새 시작 = 진행 중인 안내의 조용한 종료"가 됐다. 호출자가 거부를 통지한다.
 *
 * ⚠ 동기화가 없다 — 메인 스레드에서만 부른다(Swift `@MainActor`와 같은 계약).
 */
class GuideSessionCoordinator {
    private var currentStop: (() -> Unit)? = null
    private var currentToken = 0

    /** 활성 안내 세션 존재 여부 — 유휴 복귀 리셋(IdleReset) 예외 판정과 거부 게이트가 본다. */
    val isActive: Boolean get() = currentStop != null

    /**
     * 세션 시작 직전 호출. 반환 토큰은 release 검증 키(늦은 release가 새 소유자를 지우지 않게).
     * **null = 다른 세션이 점유 중이라 거부** — 기존 세션은 건드리지 않는다.
     */
    fun claim(stop: () -> Unit): Int? {
        if (currentStop != null) return null
        currentToken += 1
        currentStop = stop
        return currentToken
    }

    /** 세션 종료 시 호출 — 자기 토큰일 때만 비운다. */
    fun release(token: Int) {
        if (token != currentToken) return
        currentStop = null
    }

    /** 외부에서 점유 세션을 멈춰야 할 때(teardown 등). 소유자의 stop이 release를 부른다. */
    fun stopCurrent() {
        val stop = currentStop
        currentStop = null
        stop?.invoke()
    }
}
