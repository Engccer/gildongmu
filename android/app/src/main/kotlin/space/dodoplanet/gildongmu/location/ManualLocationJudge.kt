package space.dodoplanet.gildongmu.location

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.dodoplanet.gildongmu.kit.ManualVerdict
import space.dodoplanet.gildongmu.kit.judgeManualLocation

/**
 * 수동 위치 이동 판정(iOS `ManualLocationJudge.run` · 웹 `runManualLocationJudgment` 미러, spec §13-2). 트리거 3종 — 앱 시작·전경 복귀
 * (`MainActivity` `ON_START`)·force 조회(`EffectiveLocation.coordinate(force = true)`) — 이 한 함수를 부른다.
 *
 * - **어느 갈래로 끝나든 결과를 스토어에 남긴다.** 결과를 버리면 라벨이 `origin` 유무만 보게 되어, 지금 판정할 수 없는 상태(권한 철회·실내
 *   측위 실패)가 검증 가능형으로 낭독된다 — 더 나쁜 상태가 더 안심시키는 역전. 예외: 취소는 실패가 아니라 미완이라 결과를 남기지 않고 통과한다.
 * - 재진입은 `Mutex`로 직렬화하고, 마지막 실행 뒤 `minIntervalSeconds` 안의 재호출은 건너뛴다(회전·다크모드·앱 언어 변경마다 액티비티가
 *   재생성돼 `ON_START`가 다시 온다 — `configChanges` 없음). force 조회는 이 억제를 받지 않는다. 동시 트리거 2회 = 측위 1회·통지 최대 1회.
 * - 판정 측위는 화면이 요청하지 않은 측위라 `silent`(표시줄 실패 표식 미갱신).
 * - 자동 해제는 반드시 통지한다(`notify` 주입 — 프로덕션은 `AppNotices::post`): TalkBack은 포커스 밖 텍스트 변경을 읽지 않으므로 "표시줄이
 *   말한다"는 그 줄로 돌아갈 때만 성립하고, 표시줄이 없는 화면에서 복귀하면 아예 만나지 못한다.
 */
class ManualLocationJudge(
    private val manual: ManualLocationStore,
    private val location: LocationStore,
    private val now: () -> Double,
    private val notify: (String) -> Unit,
    private val autoClearedText: () -> String,
    private val minIntervalSeconds: Double = 30.0,
) {
    private val mutex = Mutex()
    private var lastRunAt: Double? = null

    suspend fun run(force: Boolean = false) {
        manual.awaitHydrated()
        mutex.withLock {
            val last = lastRunAt
            if (!force && last != null && now() - last < minIntervalSeconds) return
            judge()
            lastRunAt = now() // 결과를 남긴 시점에만 — 측위 중 취소는 예산을 쓰지 않는다(예외로 빠져나가 여기 닿지 않는다)
        }
    }

    private suspend fun judge() {
        run {
            val current = manual.current.value ?: return
            // origin이 없으면 어떤 fix로도 판정할 수 없다 — 측위 비용을 치르지 않는다.
            if (current.origin == null) { manual.setVerdict(ManualVerdict.undecidable); return }
            // 권한이 없으면 팝업을 띄우지 않고 유지한다(증거 부재). 유지하되 그 사실을 라벨이 말한다.
            if (location.authorization() != LocationPermission.Fine) { manual.setVerdict(ManualVerdict.undecidable); return }
            val captured = current.revision
            val fix = location.currentFix(force = true, silent = true) // 취소는 여기서 그대로 나간다(결과 없음)
            val verdict = judgeManualLocation(current, fix, now())
            // CAS: 판정 왕복 중 재지정됐으면 늦게 온 옛 판정을 폐기한다(해제도 라벨도).
            if (manual.current.value?.revision != captured) return
            if (verdict != ManualVerdict.drop) { manual.setVerdict(verdict); return }
            manual.clear()
            notify(autoClearedText())
        }
    }
}
