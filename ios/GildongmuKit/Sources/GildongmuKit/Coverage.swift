import Foundation

/// 대한민국 서비스 커버리지 정본 술어 — 웹 `src/lib/coverage.ts` 미러(값·알고리즘 동조,
/// 공유 fixture `korea-boundary-cases.json`이 두 구현의 합의를 강제한다).
///
/// **판정은 국경 폴리곤이고 사각형은 프리필터다**(E19, 2026-08-23). 사각형만으로는
/// 후쿠오카·기타큐슈·대마도·시모노세키가 "한국 안"으로 통과하고, 개성·해주는 파주와
/// 위경도가 겹쳐 어떤 사각형 뺄셈으로도 갈리지 않는다.
///
/// ⚠ 이 술어의 뜻은 **"한국 안인가"**이지 "이 upstream이 답하는 범위인가"가 아니다.
/// upstream 범위는 `unavailableHere`(국내 지역별 미제공)와 0건 축이 따로 든다.
private let koreaBBox = (latMin: 31.43, latMax: 44.35, lngMin: 122.37, lngMax: 132.0)

/// 국경 링(본토+제주·서해5도·울릉·독도). 리소스 `korea-boundary.json`은 웹 정본의
/// **바이트 동일 사본**이고 `korea-boundary-drift.test.ts`가 그 동일성을 강제한다.
///
/// ⚠ 파싱에 실패해 비면 전 좌표가 "밖"이 되어 앱이 통째로 죽는다 — 그 상태는
/// `CoverageTests`의 `inside: true` 케이스 아홉이 즉시 잡는다.
private let koreaRings: [[(lat: Double, lng: Double)]] = {
    guard let url = Bundle.module.url(forResource: "korea-boundary", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let rings = root["rings"] as? [[[Double]]]
    else { return [] }
    return rings.map { ring in
        ring.compactMap { point in point.count == 2 ? (lat: point[0], lng: point[1]) : nil }
    }
}()

public func isInKorea(lat: Double, lng: Double) -> Bool {
    guard (koreaBBox.latMin...koreaBBox.latMax).contains(lat),
          (koreaBBox.lngMin...koreaBBox.lngMax).contains(lng)
    else { return false }

    for ring in koreaRings {
        var inside = false
        for i in 0..<max(0, ring.count - 1) {
            let (y1, x1) = (ring[i].lat, ring[i].lng)
            let (y2, x2) = (ring[i + 1].lat, ring[i + 1].lng)
            if (y1 > lat) != (y2 > lat) {
                let xAt = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)
                if lng < xAt { inside.toggle() }
            }
        }
        if inside { return true }
    }
    return false
}
