package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneItem

// 주변 상황 문장(iOS `SurroundingsSceneSection.swift` `SceneText` 이식, spec §12-2).

/** bucket 값 → 리소스. 12개 리터럴 나열(동적 키 조립 금지). 모르는 값은 null → 호출부가 원값을 노출한다(서버가 값을 늘려도 안 깨진다). */
fun sceneBucketResId(bucket: String): Int? = when (bucket) {
    "left" -> R.string.surroundings_bucket_left
    "right" -> R.string.surroundings_bucket_right
    "across" -> R.string.surroundings_bucket_across
    "beyond" -> R.string.surroundings_bucket_beyond
    "n" -> R.string.surroundings_bucket_n
    "ne" -> R.string.surroundings_bucket_ne
    "e" -> R.string.surroundings_bucket_e
    "se" -> R.string.surroundings_bucket_se
    "s" -> R.string.surroundings_bucket_s
    "sw" -> R.string.surroundings_bucket_sw
    "w" -> R.string.surroundings_bucket_w
    "nw" -> R.string.surroundings_bucket_nw
    else -> null
}

/** 묶음이 이보다 크면 제목에 곳수를 병기한다(웹 COUNT_IN_TITLE_THRESHOLD 미러 — 스와이프 전 규모 예고). */
private const val COUNT_IN_TITLE_THRESHOLD = 3

fun sceneBucketTitle(name: String, count: Int, countLabel: (Int) -> String): String =
    if (count > COUNT_IN_TITLE_THRESHOLD) "$name ${countLabel(count)}" else name

/**
 * 항목 문장. `name`은 병기 이름의 한 변종(시각 `display` 또는 낭독 `primary`, E28). 도로명은 비-ko에서 로마자(서버 `roadRoman`) —
 * 이름과 달리 괄호 병기는 하지 않는다(문장 안 절이라 괄호가 둘이면 줄이 어지럽다). ko·로마자 부재는 원문 그대로.
 */
fun sceneItemLine(
    item: SurroundingsSceneItem,
    name: String,
    lang: String,
    withRoad: (distance: String, name: String, road: String) -> String,
    plain: (distance: String, name: String) -> String,
): String {
    val d = formatDistance(item.distanceMeters)
    val road = item.road ?: return plain(d, name)
    return withRoad(d, name, bilingualName(lang, road, en = null, roman = item.roadRoman).primary)
}

/** 항목 행의 태그·착지·pop 복귀 키(iOS `sceneItemRowID` 동형). `place-{id}`를 쓰지 않는 이유는 spec 판정 30(같은 화면의 가게 목록과 충돌). */
fun sceneItemKey(bucket: String, index: Int) = "scene-item-$bucket-$index"
