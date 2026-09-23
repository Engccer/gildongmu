package space.dodoplanet.gildongmu.place

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.StationPhoneService
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.stationNameKey
import space.dodoplanet.gildongmu.kit.subwayLineIdentity
import kotlin.math.roundToLong

/**
 * 경유역 전화번호 조회 결과 저장소(iOS `StationPhoneStore` 미러, E44 spec §5.6). 역 상세 전화 줄과 경유역 로터(E45)가 같은 키로 공유한다.
 *
 * - 메모리만. 표시(`result`)는 마지막으로 기록된 값을 그대로 돌려주고 신선도를 보지 않는다 — 오래된 번호는 갱신이 끝날 때까지 보이고,
 *   재구성만으로 조용히 사라지지 않는다.
 * - **줄 종류는 정보가 실제로 바뀔 때만 한 번 바뀐다.** 전화 줄이 번호·실패·빈 줄 사이를 오가면 스크린 리더 커서가 그 줄에서 떨어진다.
 * - 신선도는 `resolve`만 본다. 번호·없음은 [FRESH_SECONDS] 안이면 그대로 쓰고, 지나면 다시 조회한다. 화면에 떠 있는 소비자는
 *   [keepFresh]로 [RECHECK_SECONDS]마다 `resolve`를 다시 부른다.
 * - 기록 뒤 갱신되지 않은 값은 [EVICT_AFTER_SECONDS]에 지운다(카카오 결과를 무기한 들고 있지 않는다, spec §7). 그사이 갱신이
 *   실패했으면 지우지 않고 곧바로 실패로 바꾼다(번호 → 빈 줄 → 실패 줄로 두 번 바뀌지 않게).
 * - 실패는 신선도 도장을 남기지 않아 다음 조회가 재시도한다. 낡은 번호·없음 위의 갱신 실패는 값을 덮지 않고 표식만 남긴다.
 * - 같은 키 진행 중 조회는 공유한다. 조회는 저장소 스코프에서 돌아 소비자가 사라져도 취소되지 않고, 기록도 그 조회가 한다.
 * - ⚠ **메인 스레드 전용**(iOS `@MainActor`). 호출부는 컴포지션 효과·메인 스코프뿐이고 조회 본체만 전송 계층이 IO로 옮긴다.
 * - 디스크 캐시 없음: 앱 전송(`HttpUrlConnectionTransport`)에 `HttpResponseCache`가 설치돼 있지 않아 응답이 기기에 남지 않는다
 *   (iOS가 전용 ephemeral 세션을 쓰는 이유 — spec §7 약관 판정 — 가 여기선 기본값으로 성립한다). ⚠ 설치하면 이 경로가 조용히 약관
 *   위반이 된다 — `StationPhoneStoreTest`의 소스 가드가 앱 소스의 `HttpResponseCache`를 막는다.
 */
class StationPhoneStore(
    private val service: StationPhoneService,
    private val scope: CoroutineScope,
    /** 초 단위 시계(테스트는 가상 시간). */
    private val now: () -> Double,
) {
    data class Key(val station: String, val line: String, val lat: Long, val lng: Long)

    private val _results = MutableStateFlow<Map<Key, StationPhoneResult>>(emptyMap())

    /** 관찰 대상 — 전화 줄·경유역 행이 모은다. 값 조회는 [result]로 한다(키 조립을 한 곳에). */
    val results: StateFlow<Map<Key, StationPhoneResult>> = _results.asStateFlow()

    private val fetchedAt = mutableMapOf<Key, Double>()
    /** 기록 세대 — 축출 예약이 "그사이 새로 기록됐는가"를 가른다(같은 시각 두 기록도 구별된다). */
    private val generationOf = mutableMapOf<Key, Long>()
    private var generation = 0L
    /** 갱신 실패 표식 — 낡은 번호·없음 위의 갱신이 실패했음을 기억한다(값은 덮지 않는다). */
    private val refreshFailed = mutableSetOf<Key>()
    private val inflight = mutableMapOf<Key, Deferred<StationPhoneResult>>()

    /**
     * 표시용 마지막 값. null = 아직 모름(조회 전·첫 조회 중·갱신 시도 없이 보관 한도로 지워짐). `Failed` = 마지막 시도가 실패했다 —
     * 재시도 중에도 그대로이고, 재시도가 성공할 때 번호·없음으로 한 번 바뀐다. 노선 표가 모르는 노선이면 `Unavailable`(조회하지 않는다).
     */
    fun result(stationName: String, lat: Double, lng: Double, lineName: String): StationPhoneResult? {
        val key = key(stationName, lat, lng, lineName) ?: return StationPhoneResult.Unavailable
        return _results.value[key]
    }

    suspend fun resolve(stationName: String, lat: Double, lng: Double, lineName: String): StationPhoneResult {
        val key = key(stationName, lat, lng, lineName) ?: return StationPhoneResult.Unavailable
        val value = _results.value[key]
        val at = fetchedAt[key]
        if (value != null && value != StationPhoneResult.Failed && at != null && now() - at < FRESH_SECONDS) return value
        inflight[key]?.let { return it.await() }
        // 장부 대입 뒤에 시작한다(LAZY) — 즉시 실행 디스패처·중단 없는 반환에서 본문의 정리가 대입보다 먼저 돌면 완료된 조회가
        // 장부에 고착돼 이후 재조회가 영영 일어나지 않는다. 정리는 finally에서 자기 것일 때만.
        lateinit var task: Deferred<StationPhoneResult>
        task = scope.async(start = CoroutineStart.LAZY) {
            try {
                // 기록은 조회가 한다 — 기다리던 소비자가 사라져도 장부가 정리된다(공유 조회는 취소하지 않는다).
                service.lookup(stationName, lat, lng, lineName).also { record(it, key) }
            } finally {
                if (inflight[key] === task) inflight.remove(key)
            }
        }
        inflight[key] = task
        task.start()
        return task.await()
    }

    /** 화면에 떠 있는 동안 [RECHECK_SECONDS]마다 다시 부른다 — 신선하면 네트워크 없이 돌아오고, 낡으면 보관 한도 전에 갱신한다. 취소로만 끝난다. */
    suspend fun keepFresh(stationName: String, lat: Double, lng: Double, lineName: String): Nothing {
        while (true) {
            resolve(stationName, lat, lng, lineName)
            delay((RECHECK_SECONDS * 1_000).toLong())
        }
    }

    /**
     * 경유역 목록을 펼치는 순간 그 구간 역 전부를 미리 조회한다(spec §6, 리뷰 M6). ⚠ 받은 목록 **전부**에 `resolve`를 돈다 —
     * 브리핑처럼 줄마다 부르는 소비자는 그 줄의 역만 넘긴다(E45 spec §5.2).
     */
    fun prefetch(stops: List<TransitLegStop>, lineName: String) {
        for (stop in stops) scope.launch { resolve(stop.name, stop.lat, stop.lng, lineName) }
    }

    private fun record(value: StationPhoneResult, key: Key) {
        if (value == StationPhoneResult.Failed) {
            val current = _results.value[key]
            if (current != null && current != StationPhoneResult.Failed) {
                refreshFailed.add(key)
            } else if (current != StationPhoneResult.Failed) {
                // 이미 실패 줄이면 다시 대입하지 않는다(재확인마다 같은 값으로 관찰자를 깨우지 않게).
                _results.update { it + (key to StationPhoneResult.Failed) }
            }
            return
        }
        _results.update { it + (key to value) }
        refreshFailed.remove(key)
        fetchedAt[key] = now()
        val stamp = ++generation
        generationOf[key] = stamp
        scope.launch {
            delay((EVICT_AFTER_SECONDS * 1_000).toLong())
            if (generationOf[key] != stamp) return@launch
            generationOf.remove(key)
            fetchedAt.remove(key)
            // 한도까지 갱신이 성공하지 못했고 그사이 갱신이 실패했다면 곧바로 실패로, 아무도 갱신하지 않았으면 모름(null)으로.
            val failed = refreshFailed.remove(key)
            _results.update { if (failed) it + (key to StationPhoneResult.Failed) else it - key }
        }
    }

    companion object {
        /** 번호·없음의 신선 수명(서버 `kakao-local` 캐시 300초와 같다). */
        const val FRESH_SECONDS = 300.0
        /** 화면에 떠 있는 소비자가 `resolve`를 다시 부르는 간격. */
        const val RECHECK_SECONDS = 30.0
        /** 갱신되지 않은 값을 지우기까지 — 최악의 갱신(도장 뒤 300+30초 시작, 3초 상한)을 앞지르지 않게 재확인 간격 하나를 더 둔다. */
        const val EVICT_AFTER_SECONDS = FRESH_SECONDS + 2 * RECHECK_SECONDS

        /** 노선 표가 모르는 노선이면 null — 그 역은 조회하지 않고 "없음"이다(spec §5.4-4). */
        fun key(stationName: String, lat: Double, lng: Double, lineName: String): Key? {
            val station = stationNameKey(stationName)
            val line = subwayLineIdentity(lineName)
            if (station.isEmpty() || line == null) return null
            return Key(station, line, (lat * 10_000).roundToLong(), (lng * 10_000).roundToLong())
        }

        /** 앱 한 벌(역 상세·경유역 로터 공유). */
        val shared: StationPhoneStore by lazy {
            StationPhoneStore(StationPhoneService(AppConfig.apiClient), MainScope()) { System.currentTimeMillis() / 1_000.0 }
        }
    }
}
