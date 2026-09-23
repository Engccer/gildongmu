package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.kit.StationLayoutKind
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.isRepresentativePhone
import space.dodoplanet.gildongmu.nearby.NearbyKind

// 장소 상세 레이아웃(E44 spec §3, iOS `PlaceDetailView` 두 분기). 순서는 이 표가 정본이고 화면은 그대로 그린다(JVM 테스트가 잠근다).
// ⚠ 넓은 `isStation`으로 레이아웃을 고르지 말 것 — 출구 POI·"철도" 업체·이름만 "역"으로 끝나는 장소가 역 모양이 된다(설계 리뷰 M2).
// 역 섹션 **로드**는 종전대로 `isStation`이다(ViewModel).

/** 한글 보조 줄·도메인 섹션 다음에 오는 블록. */
enum class PlaceBlock {
    /** 분류·주소·영업시간·전화·홈페이지·물어보기(개편 전 순서 그대로). */
    generalInfo,
    /** 역 정보 제목 + 전화 줄 맨 위 + 메타 줄 + (기차역만) 분류 + 주소·영업시간·홈페이지·물어보기. */
    stationInfo,
    /** 역 정보 섹션(제목 + 메타 줄) — 역 레이아웃이 아닌 장소에 역 섹션이 뜨는 드문 경우(출구 POI 등). */
    stationMetaSection,
    /** 실시간 도착·첫차 막차·교통약자 시설 2종(서울 지하철은 종류별 접기). */
    stationDetail,
    barrierFree,
    route,
    nearby,
}

/** 역이면 역 정보 → 도착·시간표·시설 → 무장애 → 길찾기 → 이 장소 주변(최하단, 판정 ⑤). 그 밖은 개편 전 순서. */
fun placeDetailBlocks(kind: StationLayoutKind?): List<PlaceBlock> =
    if (kind != null) {
        listOf(PlaceBlock.stationInfo, PlaceBlock.stationDetail, PlaceBlock.barrierFree, PlaceBlock.route, PlaceBlock.nearby)
    } else {
        listOf(PlaceBlock.generalInfo, PlaceBlock.route, PlaceBlock.nearby, PlaceBlock.stationMetaSection, PlaceBlock.stationDetail, PlaceBlock.barrierFree)
    }

/**
 * "이 장소 주변" 앵커(이용 빈도순). 역 상세는 지하철 도착을 뺀다(판정 ④ — 같은 역 도착이 위 "실시간 도착"에 이미 있고 역 상세끼리는
 * 구성이 같다). 그 밖은 종류와 무관하게 종전 4종 — 행이 장소마다 사라지면 위치를 외워 쓰는 탐색이 무너진다(2026-08-02 판정).
 */
fun nearbyAnchorKinds(kind: StationLayoutKind?): List<NearbyKind> =
    if (kind != null) listOf(NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions)
    else listOf(NearbyKind.subway, NearbyKind.bus, NearbyKind.bike, NearbyKind.conditions)

/** 역 상세 전화 줄(spec §5.5): 번호(대표번호는 밝힌다, 판정 ⑥) / 조회 실패 문장 / 줄 없음. */
sealed class StationPhoneRow {
    data class Call(val phone: String, val representative: Boolean) : StationPhoneRow()
    data object Error : StationPhoneRow()
    data object None : StationPhoneRow()
}

/**
 * 자기 번호가 있으면 그것(검색 탭·채팅에서 연 역은 카카오 POI라 자기 `phone`이 전부다), 없으면 경유역 조회 결과(`looked`, 조회 대상이
 * 아니면 null). 실패는 없음과 가른다(3-state) — 지하는 통신이 끊기기 쉽고 이 줄은 가장 많이 쓸 메뉴다. 없음·모름은 줄 없음.
 */
fun stationPhoneRow(ownPhone: String?, looked: StationPhoneResult?): StationPhoneRow {
    val phone = ownPhone?.takeIf { it.isNotEmpty() }
        ?: when (looked) {
            is StationPhoneResult.Direct -> looked.phone
            is StationPhoneResult.Representative -> looked.phone
            StationPhoneResult.Failed -> return StationPhoneRow.Error
            StationPhoneResult.Unavailable, null -> return StationPhoneRow.None
        }
    return StationPhoneRow.Call(phone, isRepresentativePhone(phone))
}

/** 경유역만 조회한다(spec §5.2) — 자기 번호가 없고, 대중교통 투영 장소이며, 누르는 순간 확정한 노선 힌트가 있을 때. */
fun needsStationPhoneLookup(placeId: String, ownPhone: String?, lineHint: String?): Boolean =
    ownPhone.isNullOrEmpty() && lineHint != null && placeId.startsWith("transit-stop:")
