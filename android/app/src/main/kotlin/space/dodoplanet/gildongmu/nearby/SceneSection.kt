package space.dodoplanet.gildongmu.nearby

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.RevealWindow
import space.dodoplanet.gildongmu.kit.bilingualName
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.sceneItemToPlace
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

/**
 * "주변 상황" 자동 펼침(iOS `SurroundingsSceneAutoSection`, spec §12-2). 부모(둘러보기) 커밋과 함께 나타나고 트리거·닫기·착지가 없다 —
 * 헤딩이 발견 경로, 포커스는 부모의 위치 문장 1회 착지가 전부. 묶음별 "더 보기" 창은 ViewModel이 들고 커밋마다 리셋한다(판정 31).
 * 항목 행은 `PlaceRow`가 아니라 자체 문장 행(판정 30) — 같은 화면의 가게 목록과 `place-{id}`가 겹친다.
 */
@Composable
fun SceneAutoSection(payload: AroundPayload, vm: NearbyScreenViewModel<AroundPayload>, requesterFor: (String) -> FocusRequester, onOpenPlace: (Place, returnKey: String) -> Unit) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val windows by vm.groupWindows.collectAsState()
    val showMore = stringResource(R.string.actions_showMore)

    HeadingLine(stringResource(R.string.surroundings_ready), "scene-heading")
    val scene = payload.scene
    when {
        payload.sceneFailed || scene == null -> BodyLine(stringResource(R.string.surroundings_error), "scene-error")
        scene.total == 0 -> BodyLine(stringResource(R.string.surroundings_empty), "scene-empty")
        else -> {
            for (group in scene.groups) {
                // 묶음 제목이 유일한 발견 경로(제목 점프로 통째 건너뛰기). 미지 bucket은 원값 노출.
                val bucketName = sceneBucketResId(group.bucket)?.let { stringResource(it) } ?: group.bucket
                HeadingLine(sceneBucketTitle(bucketName, group.items.size) { appLocalized(res, R.string.surroundings_count, it) }, "scene-${group.bucket}")
                val visible = windows[group.bucket] ?: RevealWindow.initialVisible
                group.items.take(visible).forEachIndexed { i, item ->
                    val name = bilingualName(lang, item.name, en = null, roman = item.nameRoman)
                    val line = { nm: String -> sceneItemLine(item, nm, lang, { d, x, r -> appLocalized(res, R.string.surroundings_itemWithRoad, d, x, r) }) { d, x -> appLocalized(res, R.string.surroundings_item, d, x) } }
                    val key = sceneItemKey(group.bucket, i)
                    val spoken = spokenDistanceUnits(line(name.primary), meters)
                    // 한 줄 = 한 객체(버튼 → 상세). 착지 requester는 clickable의 focusable 앞(소스 가드 규칙).
                    Text(
                        line(name.display),
                        Modifier
                            .fillMaxWidth()
                            .focusRequester(requesterFor(key))
                            .clickable(role = Role.Button) { onOpenPlace(sceneItemToPlace(item), key) }
                            .testTag(key)
                            .defaultMinSize(minHeight = 48.dp)
                            .padding(vertical = 8.dp)
                            .semantics(mergeDescendants = true) { contentDescription = spoken },
                    )
                }
                if (group.items.size > visible) {
                    Button(onClick = { vm.revealMoreInGroup(group.bucket, group.items.size) { i -> sceneItemKey(group.bucket, i) } }, Modifier.tapTarget().testTag("showMore-${group.bucket}")) { Text(showMore) }
                }
            }
            // 실재성 한계 고지 — 이름을 그대로 말하는 대신 출처로 헤지.
            BodyLine(stringResource(R.string.surroundings_source), "scene-source")
        }
    }
}
