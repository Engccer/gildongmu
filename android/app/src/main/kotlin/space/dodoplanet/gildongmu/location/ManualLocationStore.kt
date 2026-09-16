package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerializationException
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.ManualVerdict

/**
 * 수동 위치의 **런타임 정본**(iOS `ManualLocationStore`·웹 `manual-location-store.ts` 미러, spec §13-1). 저장 매체는 그 뒤다 —
 * 화면이 저장소를 직접 읽고 쓰면 이미 열린 표시줄·길찾기 출발지가 즉시 갱신되지 않는다.
 *
 * - `verdict`는 **비영속**: 며칠 전 판정이 새 세션 라벨을 정하면 안 된다. 수명은 지금 담긴 수동 위치와 같아 `set`/`clear`가 함께 초기화한다.
 * - 첫 읽기는 디스크 I/O(`SharedPreferencesStore` 계약): `GildongmuApplication`이 IO에서 `hydrate()`를 띄우고, `current`를 읽는 suspend 경로
 *   전부(`EffectiveLocation`·`ManualLocationJudge`)는 `awaitHydrated()` 뒤에 읽는다 — **불변식: hydration 전 `current` 읽기는 없다**
 *   (창이 열리면 프로세스 재생성 직후 복원된 내 주변 탭이 "이번 조회만 GPS 기준"이 되고 화면으로 반증되지 않는다).
 * - 복원 시 `isValid` 실패는 폐기: 손상 값을 되살리면 haversine이 NaN을 내고 모든 비교가 false가 되어 영구 유지된다(가장 나쁜 실패 방향).
 */
class ManualLocationStore(
    private val store: KeyValueStore,
    private val now: () -> Double = { System.currentTimeMillis() / 1000.0 },
) {
    private val _current = MutableStateFlow<ManualLocation?>(null)
    val current: StateFlow<ManualLocation?> = _current.asStateFlow()

    /** 마지막 판정 시도의 결과. null = 아직 판정하지 않음(지정 직후·복원 직후). */
    private val _verdict = MutableStateFlow<ManualVerdict?>(null)
    val verdict: StateFlow<ManualVerdict?> = _verdict.asStateFlow()

    private val hydrated = CompletableDeferred<Unit>()

    /** 저장값 복원(1회). 두 번째부터 no-op. `KeyValueStore`에 삭제가 없어 빈 문자열이 "없음"이다. */
    @Synchronized
    fun hydrate() {
        if (hydrated.isCompleted) return
        val raw = store.getString(KEY)
        val decoded = raw?.takeIf { it.isNotEmpty() }?.let {
            try {
                KitJson.decodeFromString(ManualLocation.serializer(), it)
            } catch (e: SerializationException) {
                null
            } catch (e: IllegalArgumentException) {
                null
            }
        }
        if (decoded != null && isValid(decoded)) {
            _current.value = decoded
        } else if (raw != null) {
            store.putString(KEY, "") // 손상·범위 밖은 폐기
        }
        hydrated.complete(Unit)
    }

    suspend fun awaitHydrated() = hydrated.await()

    /** 지정. `revision`은 이 메서드만 증가시킨다(CAS 토큰의 단일 발급처). `labelRoman`은 지정 화면이 그 시점에 든 라틴 표기(E28). `isValid` 실패면 false(저장 없음 — 호출자가 실패를 말한다, 3-state). */
    fun set(label: String, labelRoman: String?, lat: Double, lng: Double, origin: ManualFix?): Boolean {
        val next = ManualLocation(
            revision = (_current.value?.revision ?: 0) + 1,
            label = label, labelRoman = labelRoman, lat = lat, lng = lng,
            origin = origin, setAt = now(),
        )
        if (!isValid(next)) return false
        _current.value = next
        _verdict.value = null // 새 위치에는 아직 판정이 없다(옛 위치의 결과를 물려주면 라벨이 거짓말한다)
        store.putString(KEY, KitJson.encodeToString(ManualLocation.serializer(), next))
        return true
    }

    /** 판정 결과 기록 — `ManualLocationJudge.run()`만 부른다(호출부가 CAS를 통과한 뒤). */
    fun setVerdict(next: ManualVerdict) {
        if (_verdict.value == next) return
        _verdict.value = next
    }

    fun clear() {
        if (_current.value == null) return
        _current.value = null
        _verdict.value = null
        store.putString(KEY, "")
    }

    companion object {
        const val KEY = "manualLocation"

        /**
         * iOS `isValid` 그대로 — 시각(`at`·`setAt`)의 유한성도 본다: `at`이 NaN이면 나이 비교가 항상 거짓이 되어 판정이 영구
         * `undecidable`이 되고 수동 위치가 해제도 확정도 되지 않는 상태에 갇힌다(조용한 고착).
         */
        fun isValid(m: ManualLocation): Boolean {
            if (!(m.lat.isFinite() && m.lng.isFinite() && m.setAt.isFinite())) return false
            if (m.lat !in -90.0..90.0 || m.lng !in -180.0..180.0) return false
            if (m.label.isBlank()) return false
            val o = m.origin ?: return true
            if (!(o.lat.isFinite() && o.lng.isFinite() && o.accuracy.isFinite() && o.accuracy > 0 && o.at.isFinite())) return false
            return o.lat in -90.0..90.0 && o.lng in -180.0..180.0
        }
    }
}
