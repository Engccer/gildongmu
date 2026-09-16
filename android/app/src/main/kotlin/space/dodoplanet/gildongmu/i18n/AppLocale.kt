package space.dodoplanet.gildongmu.i18n

import android.content.res.Resources
import androidx.annotation.StringRes
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.formatLocalized

/**
 * 앱 UI 언어 정본(iOS `AppLanguage` 미러). 데이터 계약(검색 lang)·:kit lang 인자·복수형 분기가 전부 여기서 나온다.
 *
 * 판정 축은 **리소스 해석기가 실제로 고른 폴더**다 — 생성 스크립트가 각 `values(-lang)/strings.xml`에 쓰는
 * 마커 `app_locale`을 읽는다. `configuration.locales[0]`를 읽으면 시스템 목록 `[de, en]`에서 리소스는
 * `values-en`을 고르는데 앱은 ko로 판정해 한 줄 안에서 언어가 섞인다(spec §5). 앱 내 언어 선택은 M1 밖이고,
 * Android 13+ 앱별 언어 설정(`locales_config.xml`)이 리소스 로케일을 바꾸면 이 값도 함께 바뀐다.
 */
object AppLocale {
    val supported: List<String> = listOf("ko", "en", "es", "fr", "it", "ja")

    /** 마커 → 지원 언어 코드. 미지·부재는 ko(기본 `values/`가 ko다). */
    fun normalize(marker: String?): String = if (marker != null && marker in supported) marker else "ko"

    fun current(res: Resources): String = normalize(res.getString(R.string.app_locale))

    /** 웹 `data-locale.ts`·iOS `AppLanguage.dataLocale` 동형: 외부 데이터는 ko 외 전부 en. */
    fun dataLocaleOf(lang: String): String = if (lang == "ko") "ko" else "en"

    fun dataLocale(res: Resources): String = dataLocaleOf(current(res))
}

/**
 * 인자 있는 문자열 조회의 **유일한** 경로 — 카탈로그 포맷(`%N$s` + ICU 복수 블록)을 :kit `formatLocalized`가
 * 푼다(A29). 인자를 붙인 `getString`·`stringResource`는 ICU 복수 블록을 풀지 못해 원문이 낭독된다 —
 * `LocalizedCallSiteGuardTest`가 그 호출 꼴을 잠근다. 인자 없는 문자열은 `stringResource(id)`를 그대로 쓴다.
 */
fun appLocalized(res: Resources, @StringRes id: Int, vararg args: Any): String =
    formatLocalized(res.getString(id), AppLocale.current(res), args.toList())
