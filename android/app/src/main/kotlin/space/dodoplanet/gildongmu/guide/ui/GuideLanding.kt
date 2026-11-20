package space.dodoplanet.gildongmu.guide.ui

import android.util.Log
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.focus.FocusRequester
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * 안내 화면 착지 관용구(spec §7): M1~M3의 `runCatching { requester.requestFocus() }.onFailure { Log.w }`에 "한 프레임 + 400ms 뒤,
 * 실패하면 600ms 뒤 한 번 더"만 더한다 — `ModalBottomSheet` 표시 애니메이션이 끝난 뒤 시스템이 포커스를 옮기므로 그보다 늦게
 * 대입한다(iOS `landTitleFocus` 동형). `requestFocus()`는 void라 Boolean 판정을 하지 않는다.
 */
suspend fun land(requester: FocusRequester, what: String) {
    withFrameNanos { }
    delay(400)
    runCatching { requester.requestFocus() }.onFailure {
        delay(600)
        runCatching { requester.requestFocus() }.onFailure { e -> Log.w("Guide", "$what 착지 실패", e) }
    }
}

/** 키별 들이기 요청자 — 착지 요청자(`requesterFor`)와 같은 키로 짝을 이룬다. ⚠ 맵은 `remember` 안에 둔다(수명이 맵의 수명이다). */
fun <K> MutableMap<K, BringIntoViewRequester>.bringFor(key: K): BringIntoViewRequester = getOrPut(key) { BringIntoViewRequester() }

/**
 * 화면 밖일 수 있는 대상으로 가는 착지(`PATTERNS` 「화면 밖 행으로 옮기는 착지는 먼저 스크롤하고 기다린 뒤 포커스를 준다」) — 가시화 → [land].
 * 대상 행에 `bringIntoViewRequester(bring)`과 `landingTarget(requester)`가 함께 달려 있어야 한다.
 */
suspend fun landRevealed(bring: BringIntoViewRequester, requester: FocusRequester, what: String) {
    withFrameNanos { }
    try { bring.bringIntoView() } catch (e: CancellationException) { throw e } catch (e: Exception) { Log.w("Guide", "$what 가시화 실패", e) }
    land(requester, what)
}
