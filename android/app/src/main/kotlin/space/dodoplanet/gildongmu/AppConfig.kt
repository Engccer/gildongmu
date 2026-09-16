package space.dodoplanet.gildongmu

import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.net.HttpUrlConnectionTransport

/**
 * 앱 전역 설정(iOS `AppConfig` 미러). 실험 기능은 플래그 값을 손으로 고치는 것이 아니라
 * 빌드 구성(`experimental`)으로 가른다. 검증되면 참조 자체를 지운다(항상 참 상수를 남기지 않는다).
 */
object AppConfig {
    val experimentalGuidanceEnabled: Boolean = BuildConfig.EXPERIMENTAL

    /** 탭 바 순서(iOS `experimentalTabOrderEnabled` 미러, K1 ① 위원장 판정 2026-08-23 실험판 판정 대기). */
    val experimentalTabOrderEnabled: Boolean = BuildConfig.EXPERIMENTAL

    /** 서버 base URL(대외 정본 도메인). 서버 계약 변경 0 — 기존 라우트만 부른다. */
    const val API_BASE_URL = "https://gildongmu.dodoplanet.space"

    /** nmap 딥링크 필수 appname(웹 NEXT_PUBLIC_APP_IDENTIFIER·iOS와 동일값). */
    const val APP_IDENTIFIER = "space.dodoplanet.gildongmu"

    /** :kit 판정 계층 + :app 전송 구현의 결합점. 화면들이 공유한다. */
    val apiClient: APIClient by lazy { APIClient(API_BASE_URL, HttpUrlConnectionTransport()) }
}
