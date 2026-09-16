package space.dodoplanet.gildongmu.place

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.kit.models.BarrierFreeDetail

/**
 * 무장애 편의시설 자동 섹션(iOS `BarrierFreeInfoSection`, spec §12-3). 자동 등장 보조 정보라 로딩 표시·통지 없음(조용히 나타남),
 * 헤딩이 유일한 발견 경로. 시설이 1개 이상일 때만 호출된다(ViewModel이 0건·실패·미매칭을 전부 null로 접는다 — 틀린 무장애 정보가
 * 정보 없음보다 위험). 한 줄=한 객체: 라벨(key→앱 언어) + 값(서버 한국어 서술 원문) 단일 텍스트.
 */
@Composable
fun BarrierFreeSection(detail: BarrierFreeDetail) {
    val res = LocalContext.current.resources
    HeadingLine(stringResource(R.string.barrierFreeInfo_heading), "barrier-free")
    for (f in detail.facilities) {
        val label = barrierFreeFacilityResId(f.key)?.let { res.getString(it) } ?: f.label
        BodyLine("$label ${f.value}", "barrier-free-${f.key}")
    }
    BodyLine(stringResource(R.string.barrierFreeInfo_source), "barrier-free-source")
}
