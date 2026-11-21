package space.dodoplanet.gildongmu.guide

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import space.dodoplanet.gildongmu.MainActivity
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.GuideBandSummary
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.guideBandSummary
import space.dodoplanet.gildongmu.kit.transitRideLineUnconfirmed
import space.dodoplanet.gildongmu.kit.joinText

// ── 띠바·알림 본문 조립기(순수 — 시트 상태 행·띠바·알림이 같은 문장을 쓴다, spec §4-3·§7-2) ──

/** 띠바 요약 한 줄. 추적 중은 거리(10m 양자화 값)·시작 직후는 "안내 중", 종료 화면은 도착/종료. */
fun bandSummaryText(ui: WalkGuideUiState, strings: Strings): String {
    val dest = ui.destinationLabel
    if (ui.arrivalDest != null) {
        return if (ui.endKind == SessionEndKind.stopped) strings.get("guide.band.ended", dest) else strings.get("guide.band.arrived", dest)
    }
    val meters = ui.bandDistanceMeters ?: return strings.get("guide.band.starting", dest)
    return strings.get("guide.band.remaining", dest, formatDistance(meters))
}

/** 알림 본문 = 상태 한 줄(`statusText`), 비면 띠바 요약. */
fun notificationBodyText(ui: WalkGuideUiState, strings: Strings): String =
    ui.statusText.ifEmpty { bandSummaryText(ui, strings) }

/** 알림 제목 = 시트 제목과 같은 문장("도보 안내, {dest}"). */
fun notificationTitleText(ui: WalkGuideUiState, strings: Strings): String =
    joinText(strings.get(if (ui.sessionKind == GuideSessionKind.car) "beacon.carHeading" else "beacon.walkHeading"), ui.destinationLabel)

/**
 * 대중교통 띠바 요약 한 줄(M5 §6-7, iOS `GildongmuApp` 띠바의 대중교통 갈래 그대로) — 판정은 Kit `guideBandSummary`, 노선을 모르면(E76 후속 ⓕ) 번호 자리가 없는
 * 전용 문장. 알림 본문(§6-4)과 띠바(단계 5)가 같은 문장을 쓴다.
 */
fun transitBandSummaryText(ui: TransitGuideUiState, strings: Strings): String {
    val state = ui.state
    val leg = state?.let { s -> ui.route?.legs?.getOrNull(s.legIndex) }
    val lineUnconfirmed = leg?.let { transitRideLineUnconfirmed(it, lock = state?.lock) } == true
    val pending = ui.pendingDestChange
    val summary = guideBandSummary(
        phase = state?.phase, boardStop = leg?.boardName, line = leg?.lineName,
        remaining = state?.remaining, hasWalkHandoff = ui.pendingWalkHandoff != null,
        destChangeLabel = pending?.label,
        destChangeFailed = pending?.phase == DestChangePhase.Failed || pending?.phase == DestChangePhase.Empty,
    )
    return when (summary) {
        is GuideBandSummary.Waiting -> strings.get("guide.band.transitWaiting", summary.stop, summary.line)
        is GuideBandSummary.Riding -> {
            val remaining = summary.remaining
            when {
                lineUnconfirmed && remaining != null -> strings.get("guide.band.transitRidingBusUnconfirmed", remaining)
                lineUnconfirmed -> strings.get("guide.band.transitRidingBusUnconfirmedNoCount")
                remaining != null -> strings.get("guide.band.transitRiding", summary.line, remaining)
                else -> strings.get("guide.band.transitRidingNoCount", summary.line)
            }
        }
        GuideBandSummary.Arrived -> strings.get("guide.band.transitArrived", ui.destinationLabel)
        is GuideBandSummary.DestChangePending -> strings.get("guide.band.transitDestChangePending", summary.label)
        is GuideBandSummary.DestChangeFailed -> strings.get("guide.band.transitDestChangeFailed", summary.label)
        null -> ""
    }
}

/** 대중교통 알림 제목 = 시트 제목과 같은 문장(iOS `GuideTitleActionsRow(heading: beacon.transitHeading, label:)`). */
fun transitNotificationTitleText(ui: TransitGuideUiState, strings: Strings): String =
    joinText(strings.get("beacon.transitHeading"), ui.destinationLabel)

/**
 * 지속 알림(spec §4-3). 플랫폼 `Notification.Builder`만(androidx 없음). 채널 `IMPORTANCE_LOW` — 소리·진동 없음.
 * 본문 탭은 앱을 전경으로 가져올 뿐 시트를 펼치지 않는다(§12-6) — 복귀 착지는 띠바가 든다. 액션 "안내 종료"는
 * 서비스 `ACTION_STOP`(`FLAG_IMMUTABLE` — minSdk 31은 가변성 플래그 없이 생성 시 예외).
 */
object GuideNotification {
    const val ID = 4101
    const val CHANNEL = "guide"
    private const val STOP_REQUEST_BASE = 1000

    /** 매 세션 시작마다 부른다 — 같은 ID의 재생성은 이름을 갱신한다(앱 언어 변경을 따라간다). */
    fun ensureChannel(context: Context, strings: Strings) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel(CHANNEL, strings.get("android.guide.notificationChannel"), NotificationManager.IMPORTANCE_LOW))
    }

    /** `generation` = 알림을 낸 서비스 세대 — 「안내 종료」가 그 세대를 싣고 돌아와 인계 직후 앞 세션의 알림이 새 세션을 끝내지 않는다(M5 §6-4). */
    fun build(context: Context, strings: Strings, title: String, text: String, generation: Int): Notification {
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // requestCode를 세대마다 가른다(§7-4 세대 거름 ①) — 한 코드에 `FLAG_UPDATE_CURRENT`면 새 알림이 옛 PendingIntent의 extra까지 새 세대로 바꿔, 넘김
        // 전에 내려 둔 옛 알림의 「안내 종료」가 세대 거름을 통과한다.
        val stop = PendingIntent.getService(
            context, STOP_REQUEST_BASE + generation,
            Intent(context, GuideForegroundService::class.java).setAction(GuideForegroundService.ACTION_STOP)
                .putExtra(GuideForegroundService.EXTRA_GENERATION, generation),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(context, CHANNEL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setSmallIcon(R.drawable.ic_guide_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, strings.get("beacon.stop"), stop).build())
            .build()
    }
}
