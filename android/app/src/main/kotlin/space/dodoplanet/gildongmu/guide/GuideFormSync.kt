package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint

/**
 * 안내 주도 변경의 길찾기 폼 동기화 채널(iOS `GuideFormSyncStore`, spec 2026-08-12 §5·M4b §3). 시트는 탭을 모르므로 이 스토어를 거치고
 * `DirectionsViewModel.applyGuideFormSync`가 소비한다. 목적지·경유지 채널을 가른다 — 한 값이면 "도착지 없이 경유지만 바뀜"을 표현할 수 없다.
 * 게시는 모델 함수가 true를 돌려줄 때만(세션에 반영되지 않은 선택은 폼에 보내지 않는다). 경유지 **도착**·삭제는 보내지 않는다(폼은 사용자 질의).
 * `take`는 읽고 비우는 한 연산이라 두 소비 경로가 같은 값을 두 번 쓰지 않는다(게시·소비 모두 메인 스레드).
 */
object GuideFormSync {
    private val _pending = MutableStateFlow<DirectionsEndpoint.Place?>(null)
    val pending: StateFlow<DirectionsEndpoint.Place?> = _pending.asStateFlow()
    private val _pendingWaypoint = MutableStateFlow<DirectionsEndpoint.Place?>(null)
    val pendingWaypoint: StateFlow<DirectionsEndpoint.Place?> = _pendingWaypoint.asStateFlow()

    fun post(endpoint: DirectionsEndpoint.Place) { _pending.value = endpoint }
    fun postWaypoint(endpoint: DirectionsEndpoint.Place) { _pendingWaypoint.value = endpoint }

    fun take(): DirectionsEndpoint.Place? = _pending.value.also { _pending.value = null }
    fun takeWaypoint(): DirectionsEndpoint.Place? = _pendingWaypoint.value.also { _pendingWaypoint.value = null }
}
