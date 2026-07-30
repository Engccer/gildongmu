import Foundation

/// 좌표 쿼리 파라미터(`?lat=&lng=`) 조립 — 좌표 기반 서비스 공용.
func coordQuery(lat: Double, lng: Double) -> [URLQueryItem] {
    [
        URLQueryItem(name: "lat", value: String(lat)),
        URLQueryItem(name: "lng", value: String(lng)),
    ]
}
