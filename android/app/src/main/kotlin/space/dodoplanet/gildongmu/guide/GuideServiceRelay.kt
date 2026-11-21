package space.dodoplanet.gildongmu.guide

/**
 * 전경 서비스 손잡이의 판정 핵심(M5 §6-4·§7-4) — 안드로이드 의존이 없어 JVM 테스트가 그대로 돈다. 실제 서비스 조작(시작·정지·프로세스 안 재결속·다음
 * 메인 턴)은 주입된 함수다(`AndroidGuideController`가 붙인다).
 *
 * 세대를 발급하고 지금 세대만 내린다(앞 세션의 늦은 정지가 새 세션의 서비스를 내리지 않게). 여정(B26)의 단계 경계는 서비스를 **내리지 않고 넘긴다**(§7-4):
 * - 정지: 지금 세대의 정지를 받았을 때 [retainer]가 새 세대를 돌려주면(여정이 살아 있고 실패 국면이 아니다) [shutdown] 대신 그 세대로 넘긴다. 재결속은 정지
 *   호출 안에서 하지 않고 **다음 메인 턴**에 한다 — 도보 모델의 `stop()`은 정지를 부른 뒤에 세대·추적 표식을 비우므로, 그 안에서 결속하면 소유자 판정이 아직
 *   도보를 돌려줘 세대 불일치로 끝난다(설계 리뷰 반영). 그 사이 서비스 이벤트는 지금 세대(보유자 것)와 맞지 않아 버려진다.
 * - 시작: 서비스가 떠 있으면(이 손잡이가 시작했고 아직 내리지 않았다 ∧ 서비스 인스턴스가 산다) [launch](`startForegroundService` — 화면이 꺼진 배경에서
 *   Android 12+가 거부한다)를 부르지 않고 다음 턴에 재결속한다. 떠 있지 않거나 재결속이 실패하면 종전대로 시작한다.
 */
class GuideServiceRelay(
    /** 서비스를 시작한다. 동기 거부(Android 12+ 백그라운드 시작 거부)면 그 예외, 아니면 null. */
    private val launch: (generation: Int) -> Throwable?,
    /** 동기 거부를 같은 세대의 시작 실패로 넘긴다(`GuideSession.serviceStartFailed`) — 지금 세대를 비운 뒤에 부른다(그 실패의 정지가 늦은 정지로 버려지게). */
    private val onStartFailed: (generation: Int, error: Throwable) -> Unit,
    /** 서비스를 내린다(동기 요청). */
    private val shutdown: () -> Unit,
    /** 떠 있는 서비스를 그 세대에 프로세스 안 호출로 다시 결속한다. 서비스 인스턴스가 없으면 false. */
    private val rebind: (generation: Int) -> Boolean,
    /** 서비스 인스턴스가 살아 있는가(전경 시작을 마친 뒤 파괴 전). */
    private val serviceLive: () -> Boolean,
    /** 다음 메인 턴에 실행한다. */
    private val post: (() -> Unit) -> Unit,
) : GuideForegroundController {
    private var issued = 0
    /** 지금 서비스를 쥔 세대(없으면 null). */
    var current: Int? = null
        private set
    /** 이 손잡이가 서비스를 시작했고 아직 내리지 않았다(정지 요청 시 동기로 내린다). */
    private var running = false

    /**
     * 지금 세대의 정지를 받았을 때 서비스를 이어받을 세대(여정 보유자, `GuideSession.retainServiceForJourney`). null이면 내린다. 이 함수가 새 세대를 발급한다
     * ([nextGeneration]).
     */
    var retainer: (() -> Int?)? = null

    override fun nextGeneration(): Int = ++issued

    override fun start(generation: Int) {
        current = generation
        if (running && serviceLive()) {
            GuideDiag.log("service handoff start gen=$generation")
            post {
                if (current != generation) return@post
                if (!rebind(generation)) {
                    running = false
                    launchNow(generation)
                }
            }
            return
        }
        launchNow(generation)
    }

    private fun launchNow(generation: Int) {
        val error = launch(generation)
        if (error == null) {
            running = true
            return
        }
        GuideDiag.log("service start rejected=${error::class.simpleName} gen=$generation")
        if (current == generation) current = null
        onStartFailed(generation, error)
    }

    override fun stop(generation: Int) {
        if (generation != current) {
            GuideDiag.log("service stop stale gen=$generation current=$current")
            return
        }
        val keep = if (running) retainer?.invoke() else null
        if (keep != null) {
            current = keep
            GuideDiag.log("service handoff keep gen=$generation to=$keep")
            post {
                if (current != keep) return@post
                if (!rebind(keep)) GuideDiag.log("service handoff rebind missed gen=$keep")
            }
            return
        }
        current = null
        running = false
        shutdown()
    }
}
