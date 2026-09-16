package space.dodoplanet.gildongmu.location

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

// 설정 화면 인텐트 한 곳(코디네이터 판정: M3 길찾기도 같은 함수를 쓴다).

/** 앱 상세 설정(권한 토글이 있는 화면). */
fun appDetailsSettingsIntent(context: Context): Intent =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))

/** 기기 위치 서비스 설정(위치가 꺼져 있을 때). */
fun locationSourceSettingsIntent(): Intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
