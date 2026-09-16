package space.dodoplanet.gildongmu.net

import kotlinx.coroutines.CancellationException

/**
 * allSettled 한 조각(서버 `Promise.allSettled` 동형) — 조각별 독립 조회(둘러보기·날씨·역 섹션)가 공유하는 횡단 유틸. 취소는 삼키지 않는다
 * (README §3 — `runCatching` 금지: 화면을 떠난 코루틴의 취소가 "전 조각 실패"로 위장하면 안 된다).
 */
suspend fun <T> settled(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}
