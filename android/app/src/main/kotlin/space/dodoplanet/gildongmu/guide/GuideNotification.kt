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
import space.dodoplanet.gildongmu.kit.formatDistance
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
    joinText(strings.get("beacon.walkHeading"), ui.destinationLabel)

/**
 * 지속 알림(spec §4-3). 플랫폼 `Notification.Builder`만(androidx 없음). 채널 `IMPORTANCE_LOW` — 소리·진동 없음.
 * 본문 탭은 앱을 전경으로 가져올 뿐 시트를 펼치지 않는다(§12-6) — 복귀 착지는 띠바가 든다. 액션 "안내 종료"는
 * 서비스 `ACTION_STOP`(`FLAG_IMMUTABLE` — minSdk 31은 가변성 플래그 없이 생성 시 예외).
 */
object GuideNotification {
    const val ID = 4101
    const val CHANNEL = "guide"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.android_guide_notificationChannel), NotificationManager.IMPORTANCE_LOW),
        )
    }

    fun build(context: Context, title: String, text: String): Notification {
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            context, 1,
            Intent(context, GuideForegroundService::class.java).setAction(GuideForegroundService.ACTION_STOP),
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
            .addAction(Notification.Action.Builder(null, context.getString(R.string.beacon_stop), stop).build())
            .build()
    }
}
