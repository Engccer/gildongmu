# 역 장소 상세 개편 (E44) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS 역 장소 상세를 역 정보(전화 맨 위) → 도착·시간표 → 교통약자 시설(종류별 접기) → 무장애 → 길찾기 → 이 장소 주변(지하철 제외) 순으로 바꾸고, 대중교통 안내 시트 경유역에 카카오 검색으로 찾은 역 전화번호(대표번호 표기)를 상세 전화 줄·경유역 로터 "전화 걸기"로 낸다.

**Architecture:** 판정은 전부 Kit 순수 함수(`StationPhone.swift`: 레이아웃 종류·이름 키·노선 키·대표번호·후보 선택)와 얇은 조회 서비스(`/api/places` 장소 트랙만, 3초)다. 앱 층은 메모리 저장소 `StationPhoneStore`(5분 보관·실패 비보관·진행 중 공유) 하나를 역 상세 전화 줄과 경유역 행 하위 뷰가 함께 읽는다. `PlaceDetailView`는 `stationLayoutKind`로 역 분기와 현행 분기를 가르고, 현행 분기는 순서·구성을 바꾸지 않는다.

**Tech Stack:** SwiftUI(iOS 18+), Swift 6, Swift Testing(`swift test`), Vitest 소스 가드(Swift 소스를 정규식으로 읽는 저장소 관례), Node 스크립트(i18n 카탈로그 생성).

**Spec:** `docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md` (판정표 §2, 레이아웃 §3, 접기 §4, 전화번호 §5, 로터 §6, 검증 §8). 실행자는 이 계획과 spec을 함께 읽는다.

**위임 판정**(자율성 헌장): 태스크 1·2·7은 파일이 겹치지 않는 독립 태스크, 3→5→6은 선행 결정이 후속 인터페이스를 바꾸는 순차(3의 뷰 이름을 5가, 5의 `stationLineHint`를 6이 쓴다). 태스크마다 서브에이전트 구현 + 리뷰, 순서대로 진행한다.

## Global Constraints

- **push·재배포 금지(2026-09-22 09:00 KST까지)**: 로컬 커밋만. `.git/hooks/pre-push`를 지우지 않는다.
- **서버 코드(`src/app`·`src/lib` 비테스트 파일)·웹 `messages/*.json` 변경 0.** 테스트 파일(`src/lib/__tests__/`)과 `scripts/` 신규 스크립트는 허용.
- 커밋: `git add <신규 파일>` 뒤 `git commit -m "…" -- <의도 경로들>`(add와 commit 사이 다른 도구 호출 금지, `git add -A` 금지). 메시지 한국어, 끝에 하니스가 알려 준 `Co-Authored-By`·`Claude-Session` 줄. 커밋 직후 `git show HEAD --stat`.
- 커밋 이메일 `engccer@gmail.com`(저장소 설정 그대로).
- **Kit에 파일을 추가하면 `android/kit/mirrors/core.json`에 `pending`으로 등재**(`mirror-registry.test.ts`).
- Kit 정규식에 약칭 클래스(`\d`·`\s`·`\w`) 금지(안드로이드 이식 규칙) — 문자 필터로 쓴다.
- 신규 문자열 키는 `ios/i18n/ios-extra/<로케일>.json` 6로케일(ko·en·es·fr·it·ja)에만. `appLocalized("키")`의 첫 인자는 반드시 문자열 리터럴(키 린터가 리터럴만 센다 — 삼항 금지).
- UI 라벨 이모지 금지, 한 줄 = 한 접근성 객체(`joinText`), 포커스 코드 추가 없음(spec §4·§6).
- 역이 아닌 장소(`stationLayoutKind == nil`)의 상세 순서·구성은 그대로다.
- 명령 모음:
  - Kit 테스트: `cd ios/GildongmuKit && swift test --filter <스위트>`
  - 소스 가드: `npx vitest run src/lib/__tests__/<파일>` (전체 `npm run test:run`)
  - 앱 컴파일: `cd ios && xcodebuild -project Gildongmu.xcodeproj -scheme Gildongmu -configuration Experimental -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"` (Release도 같은 명령에서 구성만 바꿔)
  - 앱 소스 폴더는 동기화 그룹이라 `ios/Gildongmu/` 아래 새 `.swift`는 pbxproj 편집 없이 포함된다.

---

### Task 1: Kit 판정 계층 `StationPhone.swift`

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift`
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneTests.swift`
- Create: `src/lib/__tests__/station-phone-line-table-drift.test.ts`
- Modify: `android/kit/mirrors/core.json` (entries 배열에 항목 1개)

**Interfaces:**
- Consumes: `Place`(Kit `Models/SearchModels.swift`), `PlaceSearchResult`, `APIClient.get(_:query:timeout:)`, `haversineMeters(lat1:lng1:lat2:lng2:)`.
- Produces:
  - `public enum StationLayoutKind: Sendable, Equatable { case subway, rail }`
  - `public func stationLayoutKind(_ place: Place) -> StationLayoutKind?`
  - `public func stationNameKey(_ raw: String) -> String`
  - `public func stationPhoneQuery(_ raw: String) -> String`
  - `public func subwayLineIdentity(_ raw: String) -> String?`
  - `public func isRepresentativePhone(_ phone: String) -> Bool`
  - `public enum StationPhoneResult: Sendable, Equatable { case direct(String), representative(String), unavailable, failed }`
  - `public let stationPhoneMaxMeters: Double` (= 1000)
  - `public func pickStationPhone(places: [Place], stationName: String, lat: Double, lng: Double, lineName: String) -> StationPhoneResult`
  - `public struct StationPhoneService: Sendable { public init(client: APIClient); public func lookup(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult }`

- [ ] **Step 1: 실패하는 Kit 테스트 작성**

`ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneTests.swift`:

```swift
import Testing
import Foundation
@testable import GildongmuKit

// 역 장소 상세 개편(E44) 판정 계층 — spec 2026-09-17-station-detail-reorg-design.md §3.1·§5.4.
// fixture 모양은 2026-09-17 실호출(설계 리뷰 18회) 응답에서 옮겼다. 번호는 실제 역 번호다(공개 정보).

private func poi(
    _ name: String, _ category: String, _ phone: String?,
    lat: Double, lng: Double, id: String = "kakao-1"
) -> Place {
    Place(id: id, name: name, category: category, address: "", roadAddress: "",
          englishAddress: nil, lat: lat, lng: lng, phone: phone, link: nil, distanceMeters: nil)
}

private let subwayCat = "교통,수송 > 지하철,전철 > "

// MARK: stationLayoutKind

@Test func layoutKindSubwayForKakaoStationPOI() {
    #expect(stationLayoutKind(poi("천호역 5호선", subwayCat + "수도권5호선", "02-6311-5471", lat: 37.5387, lng: 127.1234)) == .subway)
}

@Test func layoutKindSubwayForTransitStop() {
    let stop = TransitLegStop(name: "군자", stationId: "2544", lat: 37.557226, lng: 127.07954)
    #expect(stationLayoutKind(transitStopPlace(stop)) == .subway)
}

@Test func layoutKindNilForExitPOI() {
    #expect(stationLayoutKind(poi("천호역 5호선 5번출구", subwayCat + "지하철출구", nil, lat: 37.5387, lng: 127.1234)) == nil)
}

@Test func layoutKindNilForNaverMergedStationPOI() {
    // 네이버 병합 역 POI는 분류가 "지하철,전철"에서 끝난다(번호도 없다).
    #expect(stationLayoutKind(poi("판교역 신분당선", "교통,수송>지하철,전철", nil, lat: 37.3948, lng: 127.1112, id: "naver-local-1")) == nil)
}

@Test func layoutKindNilForRailContractorAndNameOnlyStation() {
    #expect(stationLayoutKind(poi("코레일테크", "산업 > 건설,시공 > 시공업체 > 도로,철도시공", nil, lat: 36.33, lng: 127.43)) == nil)
    #expect(stationLayoutKind(poi("역전할머니맥주 길동역", "음식점 > 술집 > 호프,요리주점", nil, lat: 37.53, lng: 127.14)) == nil)
}

@Test func layoutKindRailForKTXStation() {
    #expect(stationLayoutKind(poi("서울역", "교통,수송 > 기차,철도 > 기차역 > KTX정차역", "1544-7788", lat: 37.5547, lng: 126.9707)) == .rail)
}

// MARK: 이름 키·검색어

@Test func stationNameKeyNormalizes() {
    #expect(stationNameKey("천호(풍납토성)") == "천호")
    #expect(stationNameKey("관악산역(서울대)") == "관악산")
    #expect(stationNameKey("시청.용인대역") == "시청용인대")
    #expect(stationNameKey("시청·용인대") == "시청용인대")
    #expect(stationNameKey("동대문역사문화공원역") == "동대문역사문화공원")
    #expect(stationNameKey("역삼역") == "역삼")
    #expect(stationNameKey("서울역") == "서울")
    #expect(stationNameKey("역") == "역")
}

@Test func stationPhoneQueryAppendsStationSuffixOnce() {
    #expect(stationPhoneQuery("천호(풍납토성)") == "천호역")
    #expect(stationPhoneQuery("서울역") == "서울역")
    #expect(stationPhoneQuery("시청·용인대") == "시청·용인대역")
}

// MARK: 노선 키

@Test func subwayLineIdentityMatchesAcrossProducers() {
    #expect(subwayLineIdentity("수도권 7호선") == subwayLineIdentity("7호선"))
    #expect(subwayLineIdentity("수도권 수인.분당선") == subwayLineIdentity("수인분당선"))
    #expect(subwayLineIdentity("수도권 9호선(급행)") == subwayLineIdentity("9호선"))
    #expect(subwayLineIdentity("부산 1호선") == subwayLineIdentity("부산1호선"))
    #expect(subwayLineIdentity("수도권 공항철도") == subwayLineIdentity("공항철도"))
    #expect(subwayLineIdentity("수도권 7호선") != nil)
}

@Test func subwayLineIdentitySeparatesSeoulAndIncheonLine1() {
    #expect(subwayLineIdentity("1호선") != subwayLineIdentity("인천1호선"))
}

@Test func subwayLineIdentityUnknownIsNil() {
    #expect(subwayLineIdentity("화성 트램") == nil)
}

// MARK: 대표번호

@Test func representativePhoneShape() {
    #expect(isRepresentativePhone("1544-7788"))
    #expect(isRepresentativePhone("1599-7788"))
    #expect(isRepresentativePhone("1588-7788"))
    #expect(isRepresentativePhone("1544-5005"))
    #expect(!isRepresentativePhone("02-6110-1281"))
    #expect(!isRepresentativePhone("031-8018-7750"))
    #expect(!isRepresentativePhone("1330"))
    #expect(!isRepresentativePhone("010-1234-5678"))
}

// MARK: pickStationPhone

@Test func pickDoesNotConfuseDongdaemunWithHistoryCulturePark() {
    let places = [
        poi("동대문역사문화공원역 2호선", subwayCat + "수도권2호선", "02-6110-2051", lat: 37.5657, lng: 127.0079),
        poi("동대문역 4호선", subwayCat + "수도권4호선", "02-6110-4211", lat: 37.5714, lng: 127.0098),
    ]
    #expect(pickStationPhone(places: places, stationName: "동대문", lat: 37.5714, lng: 127.0100, lineName: "수도권 2호선") == .unavailable)
    #expect(pickStationPhone(places: places, stationName: "동대문역사문화공원", lat: 37.5657, lng: 127.0080, lineName: "수도권 2호선") == .direct("02-6110-2051"))
}

@Test func pickUsesHintLineAtBupyeong() {
    let places = [
        poi("부평역 1호선", subwayCat + "수도권1호선", "032-528-1439", lat: 37.4895, lng: 126.7245),
        poi("부평역 인천1호선", subwayCat + "인천1호선", "032-515-9103", lat: 37.4906, lng: 126.7240),
    ]
    #expect(pickStationPhone(places: places, stationName: "부평", lat: 37.4894, lng: 126.7249, lineName: "수도권 1호선") == .direct("032-528-1439"))
    #expect(pickStationPhone(places: places, stationName: "부평", lat: 37.4894, lng: 126.7249, lineName: "인천 1호선") == .direct("032-515-9103"))
}

@Test func pickDoesNotFallBackToOtherLineWhenHintLineHasNoPhone() {
    let places = [
        poi("김포공항역 서해선", subwayCat + "서해선", nil, lat: 37.5622, lng: 126.8013),
        poi("김포공항역 9호선", subwayCat + "수도권9호선", "02-2656-0902", lat: 37.5616, lng: 126.8012),
    ]
    #expect(pickStationPhone(places: places, stationName: "김포공항", lat: 37.5620, lng: 126.8010, lineName: "수도권 서해선") == .unavailable)
}

@Test func pickPrefersPhonedPOIAmongSameLineDuplicates() {
    let places = [
        poi("김포공항역 9호선", subwayCat + "수도권9호선", nil, lat: 37.5620, lng: 126.8010, id: "kakao-2"),
        poi("김포공항역 9호선", subwayCat + "수도권9호선", "02-2656-0902", lat: 37.5616, lng: 126.8012),
    ]
    #expect(pickStationPhone(places: places, stationName: "김포공항", lat: 37.5620, lng: 126.8010, lineName: "수도권 9호선") == .direct("02-2656-0902"))
}

@Test func pickMarksRepresentativeNumbers() {
    let places = [
        poi("선릉역 수인분당선", subwayCat + "수인분당선", "1544-7788", lat: 37.5045, lng: 127.0490),
        poi("서면역 부산1호선", subwayCat + "부산1호선", "1544-5005", lat: 35.1578, lng: 129.0592),
    ]
    #expect(pickStationPhone(places: places, stationName: "선릉", lat: 37.5046, lng: 127.0492, lineName: "수도권 수인.분당선") == .representative("1544-7788"))
    #expect(pickStationPhone(places: places, stationName: "서면", lat: 35.1579, lng: 129.0593, lineName: "부산 1호선") == .representative("1544-5005"))
}

@Test func pickMatchesNameTailNotCategoryTail() {
    // 분류 끝은 "우이신설경전철"·"용인에버라인"이지만 이름 꼬리가 노선 표기다.
    let places = [
        poi("신설동역 우이신설선", subwayCat + "우이신설경전철", "02-3499-5561", lat: 37.5760, lng: 127.0250),
        poi("시청.용인대역 에버라인", subwayCat + "용인에버라인", "031-329-3573", lat: 37.2393, lng: 127.1889),
    ]
    #expect(pickStationPhone(places: places, stationName: "신설동", lat: 37.5760, lng: 127.0249, lineName: "수도권 우이신설선") == .direct("02-3499-5561"))
    #expect(pickStationPhone(places: places, stationName: "시청·용인대", lat: 37.2393, lng: 127.1889, lineName: "용인에버라인") == .direct("031-329-3573"))
}

@Test func pickRejectsSameNameStationFarAway() {
    let places = [poi("양평역 경의중앙선", subwayCat + "경의중앙선", "1544-7788", lat: 37.4926, lng: 127.4918)]
    // 5호선 양평(서울 영등포) 좌표에서 경의중앙선 노선으로 물어도 53km라 후보가 아니다.
    #expect(pickStationPhone(places: places, stationName: "양평", lat: 37.5260, lng: 126.8866, lineName: "경의중앙선") == .unavailable)
}

@Test func pickIgnoresExitAndNaverDuplicates() {
    let places = [
        poi("천호역 5호선 5번출구", subwayCat + "지하철출구", "02-0000-0000", lat: 37.5388, lng: 127.1235),
        poi("천호역 5호선", "교통,수송>지하철,전철", "02-1111-1111", lat: 37.5387, lng: 127.1234, id: "naver-local-9"),
    ]
    #expect(pickStationPhone(places: places, stationName: "천호", lat: 37.5387, lng: 127.1234, lineName: "수도권 5호선") == .unavailable)
}

@Test func pickUnknownLineIsUnavailable() {
    let places = [poi("천호역 5호선", subwayCat + "수도권5호선", "02-6311-5471", lat: 37.5387, lng: 127.1234)]
    #expect(pickStationPhone(places: places, stationName: "천호", lat: 37.5387, lng: 127.1234, lineName: "화성 트램") == .unavailable)
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios/GildongmuKit && swift test --filter StationPhoneTests 2>&1 | tail -5`
Expected: 컴파일 실패 — `cannot find 'stationLayoutKind' in scope` 류.

- [ ] **Step 3: 노선 표 미러 줄 생성(결정론)**

웹 표 `src/lib/subway-line-names.ts`의 `LINE_EN` 항목을 Swift 사전 줄로 그대로 뽑는다(손으로 옮기지 않는다):

```bash
node -e '
const s=require("fs").readFileSync("src/lib/subway-line-names.ts","utf8");
const block=s.slice(s.indexOf("const LINE_EN"), s.indexOf("};", s.indexOf("const LINE_EN")));
for (const m of block.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",\s*$/gm)) console.log(`    "${m[1]}": "${m[2]}",`);
' > /tmp/claude-line-table.txt && wc -l /tmp/claude-line-table.txt
```
Expected: 80줄 안팎(항목 수와 같다). 이 줄들을 Step 4 파일의 `subwayLineIdentityTable` 사전 본문에 붙여 넣는다.

- [ ] **Step 4: 구현**

`ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift`:

```swift
import Foundation

// 역 장소 상세 개편(E44) — spec docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md §3.1·§5.
// 순수 판정 + 얇은 조회 서비스. ⚠ 안드로이드 :kit 이식 규칙상 정규식 약칭 클래스를 쓰지 않는다(문자 필터).

/// 역 상세 레이아웃 종류(spec §3.1). `isStation`보다 좁다 — 출구 POI·시공업체·이름만 `역`으로 끝나는 장소는 nil이고
/// nil 장소의 상세는 개편 전 레이아웃 그대로다.
public enum StationLayoutKind: Sendable, Equatable {
    case subway
    case rail
}

public func stationLayoutKind(_ place: Place) -> StationLayoutKind? {
    if place.id.hasPrefix("transit-stop:") { return .subway }
    let segments = place.category.split(separator: ">").map { $0.trimmingCharacters(in: .whitespaces) }
    if segments.contains("지하철,전철"), let last = segments.last, last != "지하철출구", last != "지하철,전철" {
        return .subway
    }
    if segments.contains("기차역") { return .rail }
    return nil
}

/// 역 이름 비교 키(spec §5.4-1): 괄호 부기·공백·`.`·`·` 제거 뒤 끝 `역` 한 글자를 뗀다.
public func stationNameKey(_ raw: String) -> String {
    var out = ""
    var depth = 0
    for ch in raw {
        if ch == "(" { depth += 1; continue }
        if ch == ")" { depth = max(0, depth - 1); continue }
        if depth > 0 || ch == " " || ch == "." || ch == "·" { continue }
        out.append(ch)
    }
    if out.count > 1, out.hasSuffix("역") { out.removeLast() }
    return out
}

/// 카카오 검색어 — 괄호 부기를 뺀 역 이름에 `역`을 한 번만 붙인다(표기 구두점은 남긴다).
public func stationPhoneQuery(_ raw: String) -> String {
    var out = ""
    var depth = 0
    for ch in raw {
        if ch == "(" { depth += 1; continue }
        if ch == ")" { depth = max(0, depth - 1); continue }
        if depth == 0 { out.append(ch) }
    }
    let trimmed = out.trimmingCharacters(in: .whitespaces)
    return trimmed.hasSuffix("역") ? trimmed : trimmed + "역"
}

/// 노선 정체성(spec §5.4-2) — 웹 `subwayLineKey`와 같은 정규화(공백·마침표 제거, `수도권` 접두·`(급행)` 꼬리 제거) 뒤
/// 노선명 표의 영문 값. 미지 표기는 nil.
public func subwayLineIdentity(_ raw: String) -> String? {
    var s = String(raw.filter { $0 != " " && $0 != "." })
    if s.hasPrefix("수도권") { s.removeFirst(3) }
    if s.hasSuffix("(급행)") { s.removeLast(4) }
    return subwayLineIdentityTable[s]
}

/// 웹 `src/lib/subway-line-names.ts` `LINE_EN` 미러 — 항목 동일은 `station-phone-line-table-drift.test.ts`가 강제한다.
/// ⚠ 줄 모양 `"키": "값",` 한 줄 하나를 지킨다(드리프트 테스트가 그 모양으로 읽는다).
let subwayLineIdentityTable: [String: String] = [
    // (Step 3에서 생성한 줄을 여기에 붙여 넣는다)
]

/// 전국 대표번호(15xx·16xx·18xx 8자리) 판별(판정 ⑥).
public func isRepresentativePhone(_ phone: String) -> Bool {
    let digits = phone.filter { $0 >= "0" && $0 <= "9" }
    guard digits.count == 8 else { return false }
    return ["15", "16", "18"].contains(String(digits.prefix(2)))
}

/// 조회 결과 3상태(spec §5.5) — 번호는 직통/대표번호로 갈린다. `.failed`는 서비스만 낸다.
public enum StationPhoneResult: Sendable, Equatable {
    case direct(String)
    case representative(String)
    case unavailable
    case failed
}

/// 동명이역 차단 상한(spec §5.4-3).
public let stationPhoneMaxMeters: Double = 1_000

/// 후보 선택(spec §5.4): 역 키·노선 키 일치 ∧ 1,000m 이내인 지하철역 POI 중 번호 있는 것의 최근접.
/// 다른 노선 번호로 떨어지지 않는다(리뷰 M1).
public func pickStationPhone(
    places: [Place], stationName: String, lat: Double, lng: Double, lineName: String
) -> StationPhoneResult {
    let key = stationNameKey(stationName)
    guard !key.isEmpty, let line = subwayLineIdentity(lineName) else { return .unavailable }
    var best: (phone: String, meters: Double)?
    for place in places {
        guard !place.id.hasPrefix("transit-stop:"), stationLayoutKind(place) == .subway,
              let space = place.name.lastIndex(of: " ") else { continue }
        let head = String(place.name[..<space])
        let tail = String(place.name[place.name.index(after: space)...])
        guard stationNameKey(head) == key, subwayLineIdentity(tail) == line else { continue }
        let meters = haversineMeters(lat1: lat, lng1: lng, lat2: place.lat, lng2: place.lng)
        guard meters <= stationPhoneMaxMeters,
              let phone = place.phone?.trimmingCharacters(in: .whitespaces), !phone.isEmpty else { continue }
        if best == nil || meters < best!.meters { best = (phone, meters) }
    }
    guard let best else { return .unavailable }
    return isRepresentativePhone(best.phone) ? .representative(best.phone) : .direct(best.phone)
}

/// 경유역 전화번호 조회(spec §5.3): `/api/places` 장소 트랙만(주소·유료 웹검색 호출 없음), 3초 상한, 언어는 항상 ko.
public struct StationPhoneService: Sendable {
    let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func lookup(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult {
        let query = [
            URLQueryItem(name: "query", value: stationPhoneQuery(stationName)),
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "lang", value: "ko"),
        ]
        do {
            let result: PlaceSearchResult = try await client.get("/api/places", query: query, timeout: 3)
            return pickStationPhone(
                places: result.places, stationName: stationName, lat: lat, lng: lng, lineName: lineName)
        } catch {
            return .failed
        }
    }
}
```

붙여 넣은 뒤 `// (Step 3에서 …)` 주석 줄은 지운다.

- [ ] **Step 5: Kit 테스트 통과 확인**

Run: `cd ios/GildongmuKit && swift test --filter StationPhoneTests 2>&1 | tail -5`
Expected: 전 테스트 통과. `pickMatchesNameTailNotCategoryTail`이 실패하면 표에 `우이신설선`·`에버라인`·`용인에버라인` 항목이 있는지 확인(웹 표에 있어야 정상이다 — 없으면 웹 표를 고치지 말고 테스트 기대를 표 사실에 맞춰 원인을 커밋 메시지에 적는다).

- [ ] **Step 6: 노선 표 드리프트 가드 작성·실행**

`src/lib/__tests__/station-phone-line-table-drift.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kit `StationPhone.swift`의 노선명 표는 웹 `subway-line-names.ts` `LINE_EN`의 미러다(E44 spec §5.4-2).
 * 경유역 전화번호 선택의 노선 일치가 이 표에 달려 있어, 한쪽만 늘면 iOS만 조용히 "번호 없음"이 된다.
 */
const ROOT = join(__dirname, "../../..");
const entries = (src: string, start: string, end: string) => {
  const from = src.indexOf(start);
  const block = src.slice(from, src.indexOf(end, from));
  return new Map([...block.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",\s*$/gm)].map((m) => [m[1], m[2]]));
};

describe("역 전화번호 노선 표 드리프트", () => {
  const web = entries(readFileSync(join(ROOT, "src/lib/subway-line-names.ts"), "utf8"), "const LINE_EN", "};");
  const kit = entries(
    readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift"), "utf8"),
    "let subwayLineIdentityTable",
    "\n]",
  );

  it("Kit 표 항목이 웹 LINE_EN과 같다", () => {
    expect(web.size).toBeGreaterThan(50);
    expect([...kit.entries()].sort()).toEqual([...web.entries()].sort());
  });

  it("ODsay 관측 노선명은 전부 표 키를 가진다", () => {
    const observed = JSON.parse(
      readFileSync(join(ROOT, "src/lib/__tests__/fixtures/odsay-lane-names-observed.json"), "utf8"),
    ).lanes as { nameKor: string }[];
    const key = (ko: string) =>
      ko.trim().replace(/[\s.]/g, "").replace(/^수도권/, "").replace(/\(급행\)$/, "");
    expect(observed.filter((l) => !kit.has(key(l.nameKor))).map((l) => l.nameKor)).toEqual([]);
  });
});
```

Run: `npx vitest run src/lib/__tests__/station-phone-line-table-drift.test.ts`
Expected: 2 passed.

- [ ] **Step 7: 안드로이드 미러 등록부**

`android/kit/mirrors/core.json`의 `entries` 배열(알파벳 순서를 지키는 자리 — `StationMatch.swift` 항목 바로 뒤)에 추가:

```json
    {
      "swift": "StationPhone.swift",
      "status": "pending",
      "note": "E44 역 상세 개편. 노선 표는 웹 LINE_EN 미러(드리프트 가드 station-phone-line-table-drift.test.ts). 정규식 약칭 클래스 없음"
    },
```

Run: `npx vitest run src/lib/__tests__/mirror-registry.test.ts`
Expected: PASS.

- [ ] **Step 8: 변이 주입으로 검출력 확인(커밋 뒤가 아니라 파일 복사본으로)**

`pickStationPhone`의 `subwayLineIdentity(tail) == line` 조건을 임시로 지운 사본으로 테스트가 실패하는지 본다:

```bash
cp ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift /tmp/claude-station-phone.bak
sed -i '' 's/guard stationNameKey(head) == key, subwayLineIdentity(tail) == line else { continue }/guard stationNameKey(head) == key else { continue }/' ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift
(cd ios/GildongmuKit && swift test --filter StationPhoneTests 2>&1 | grep -E "failed|passed" | tail -2)
cp /tmp/claude-station-phone.bak ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift
(cd ios/GildongmuKit && swift test --filter StationPhoneTests 2>&1 | tail -2)
```
Expected: 변이 사본에서 `pickUsesHintLineAtBupyeong`·`pickDoesNotFallBackToOtherLineWhenHintLineHasNoPhone` 실패, 원복 뒤 전부 통과.

- [ ] **Step 9: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneTests.swift src/lib/__tests__/station-phone-line-table-drift.test.ts && git commit -m "feat(kit): 역 전화번호 판정 계층 — 레이아웃 종류·이름 키·노선 키(웹 표 미러)·대표번호·후보 선택·조회 서비스 (E44)

<attribution 줄>" -- ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneTests.swift src/lib/__tests__/station-phone-line-table-drift.test.ts android/kit/mirrors/core.json
git show HEAD --stat
```

---

### Task 2: 신규 문자열 키 4개

**Files:**
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json`
- Regenerate: `ios/Gildongmu/Resources/Localizable.xcstrings`, `ios/i18n/arg-order.json`, `android/app/src/main/res/values*/strings.xml`(생성물 — 스크립트가 쓰는 경로 그대로)

**Interfaces:**
- Produces(앱 카탈로그 키): `ios.station.kindCountStopped`(인자 `label`, `count`, `stopped`) · `ios.station.phoneError`(인자 없음) · `ios.place.callRepresentativeLine`(인자 `phone`) · `ios.place.callRepresentative`(인자 없음)

- [ ] **Step 1: ios-extra 6로케일에 키 추가**

각 파일의 `ios.station` 객체에 두 키, `ios.place` 객체에 두 키를 더한다(기존 키 뒤). 문안:

| 키 | ko | en | es | fr | it | ja |
|---|---|---|---|---|---|---|
| `ios.station.kindCountStopped` | `{label} {count}곳, 운행 중지 {stopped}곳` | `{label}: {count}, {stopped} out of service` | `{label}: {count}, {stopped} fuera de servicio` | `{label} : {count}, {stopped} hors service` | `{label}: {count}, {stopped} fuori servizio` | `{label}{count}か所、運行停止{stopped}か所` |
| `ios.station.phoneError` | `역 전화번호를 불러오지 못했습니다.` | `Couldn't load the station phone number.` | `No se pudo cargar el teléfono de la estación.` | `Impossible de charger le numéro de la gare.` | `Impossibile caricare il numero della stazione.` | `駅の電話番号を読み込めませんでした。` |
| `ios.place.callRepresentativeLine` | `전화 걸기, 대표번호 {phone}` | `Call, main line {phone}` | `Llamar, número central {phone}` | `Appeler, standard {phone}` | `Chiama, numero centrale {phone}` | `電話をかける、代表番号 {phone}` |
| `ios.place.callRepresentative` | `대표번호로 전화 걸기` | `Call main line` | `Llamar al número central` | `Appeler le standard` | `Chiama il numero centrale` | `代表番号に電話をかける` |

편집은 python으로 JSON을 읽고 써서 들여쓰기(2칸)·키 순서를 보존한다:

```bash
python3 - <<'EOF'
import json
T = {
 "ko": ("{label} {count}곳, 운행 중지 {stopped}곳","역 전화번호를 불러오지 못했습니다.","전화 걸기, 대표번호 {phone}","대표번호로 전화 걸기"),
 "en": ("{label}: {count}, {stopped} out of service","Couldn't load the station phone number.","Call, main line {phone}","Call main line"),
 "es": ("{label}: {count}, {stopped} fuera de servicio","No se pudo cargar el teléfono de la estación.","Llamar, número central {phone}","Llamar al número central"),
 "fr": ("{label} : {count}, {stopped} hors service","Impossible de charger le numéro de la gare.","Appeler, standard {phone}","Appeler le standard"),
 "it": ("{label}: {count}, {stopped} fuori servizio","Impossibile caricare il numero della stazione.","Chiama, numero centrale {phone}","Chiama il numero centrale"),
 "ja": ("{label}{count}か所、運行停止{stopped}か所","駅の電話番号を読み込めませんでした。","電話をかける、代表番号 {phone}","代表番号に電話をかける"),
}
for lang,(stopped,err,repLine,rep) in T.items():
    p=f"ios/i18n/ios-extra/{lang}.json"
    d=json.load(open(p))
    d["ios"]["station"]["kindCountStopped"]=stopped
    d["ios"]["station"]["phoneError"]=err
    d["ios"]["place"]["callRepresentativeLine"]=repLine
    d["ios"]["place"]["callRepresentative"]=rep
    open(p,"w").write(json.dumps(d,ensure_ascii=False,indent=2)+"\n")
EOF
git diff --stat ios/i18n/ios-extra
```
Expected: 6파일 각 4줄 추가(다른 줄 변화 0 — 변화가 있으면 원래 파일의 들여쓰기·끝 줄바꿈 관례를 확인해 맞춘다).

- [ ] **Step 2: 카탈로그 재생성**

```bash
node ios/scripts/messages-to-xcstrings.mjs app
node ios/scripts/check-xcstrings-keys.mjs
node android/scripts/messages-to-android-strings.mjs
```
Expected: 키 린터 exit 0(린터는 "코드가 부르는데 카탈로그에 없는 키"만 막는다 — 아직 안 쓰는 신규 키는 통과). `arg-order.json`에 신규 키가 자동 등록된다.

- [ ] **Step 3: 드리프트 가드 실행**

Run: `npx vitest run src/lib/__tests__/android-strings-drift.test.ts src/lib/__tests__/i18n-messages.test.ts`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git commit -m "i18n(ios): 역 상세 개편 문자열 4키 — 운행 중지 수·전화번호 조회 실패·대표번호 전화 줄·대표번호 로터 (E44)

<attribution 줄>" -- ios/i18n/ios-extra ios/Gildongmu/Resources/Localizable.xcstrings ios/i18n/arg-order.json android/app/src/main/res
git show HEAD --stat
```

---

### Task 3: 역 섹션 분리·교통약자 시설 종류별 접기

**Files:**
- Modify: `ios/Gildongmu/StationSections.swift`(뷰 부분 51행 이후)
- Modify: `ios/Gildongmu/PlaceDetailView.swift`(호출부 한 줄만 — 태스크 5가 전면 개편하기 전까지 컴파일 유지)
- Create: `src/lib/__tests__/station-detail-guard.test.ts`

**Interfaces:**
- Consumes: 태스크 2의 `ios.station.kindCountStopped`.
- Produces:
  - `struct StationMetaSection: View { let model: StationSectionsModel }` — 개편 전 역 정보 섹션(제목 + 메타 줄), 현행 분기 전용
  - `struct StationMetaLine: View { let model: StationSectionsModel }` — 메타 줄 행 하나(없으면 빈 뷰), 역 분기 역 정보 섹션 안
  - `struct StationDetailSections: View { let model: StationSectionsModel }` — 실시간 도착·첫차막차·교통약자 시설(철도)·교통약자 시설(서울 지하철, 접기)
  - `StationSectionsView`는 삭제한다.

- [ ] **Step 1: 실패하는 소스 가드 작성**

`src/lib/__tests__/station-detail-guard.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 역 장소 상세 개편(E44, spec docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md)의 소스 가드.
 * 앱 타깃엔 뷰 테스트 레인이 없어 구조를 소스로 잠근다(저장소 관례 — transit-landing-guard.test.ts).
 */
const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SECTIONS = read("ios/Gildongmu/StationSections.swift");

const structBody = (src: string, name: string) => {
  const start = src.indexOf(`struct ${name}`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n}\n", start));
};

describe("교통약자 시설 종류별 접기 (spec §4)", () => {
  const body = structBody(SECTIONS, "StationDetailSections");

  it("종류마다 DisclosureGroup이고 펼침 집합은 비어서 시작한다", () => {
    expect(body).toContain("@State private var expandedKinds: Set<String> = []");
    expect(body).toMatch(/DisclosureGroup\(isExpanded: expansion\(for: group\.kind\)\)/);
  });

  it("접힘 라벨은 운행 중지 수를 싣는다", () => {
    expect(body).toContain('appLocalized("ios.station.kindCountStopped"');
    expect(body).toContain('$0.operatingStatus == "stopped"');
  });

  it("보강 실패 줄은 종류 행들 앞, 음성유도기 기준일 줄은 음성유도기 묶음 안", () => {
    const failed = body.indexOf('appLocalized("subway.supplementFailed")');
    const groups = body.indexOf("ForEach(facilities.groups");
    expect(failed).toBeGreaterThan(-1);
    expect(failed).toBeLessThan(groups);
    const source = body.indexOf('appLocalized("subway.voiceGuideSource")');
    expect(source).toBeGreaterThan(groups);
    expect(body.slice(groups, source)).toContain('group.kind == "voiceGuide"');
  });

  it("역 정보 섹션(제목 포함)은 StationDetailSections에 없다 — 레이아웃이 자리를 정한다", () => {
    expect(body).not.toContain("stationMeta.heading");
    expect(SECTIONS).not.toContain("struct StationSectionsView");
  });
});
```

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts`
Expected: FAIL(`struct StationDetailSections` 없음).

- [ ] **Step 2: 뷰 분리·접기 구현**

`ios/Gildongmu/StationSections.swift`에서 51행 주석부터 `struct StationSectionsView` 끝까지의 **선언부·메타 섹션·교통약자 시설(서울 지하철) 블록·`metaLine`**을 아래로 바꾼다(나머지 private 헬퍼 `countText`·`operatingStatusText`·`metroKindLabel`·`dailyTypeLabel`·`directionLabel`·`lineDisplayName`·`lineKoName`·`terminusReady`·`facilityName`·`facilityDetail`·`compassLabel`·`coverageText`·`trainText`는 `StationDetailSections` 안에 그대로 둔다).

(a) 파일의 `/// 역 자동 섹션 5종. …` 주석과 `struct StationSectionsView: View {` 선언, `var body` 첫 블록(`if let meta = model.meta { Section { metaLine(meta) } header: {…} }`)을 다음으로 교체:

```swift
/// 역 정보 섹션(개편 전 모양, 제목 + 메타 한 줄) — `stationLayoutKind == nil`인 장소 상세 전용(E44 spec §3.1).
/// 자동 등장 보조 정보라 로딩 표시·통지 없음, 제목이 유일한 발견 경로(헌장 §3).
struct StationMetaSection: View {
    let model: StationSectionsModel

    var body: some View {
        if let meta = model.meta {
            Section {
                StationMetaText(meta: meta)
            } header: {
                Text(appLocalized("stationMeta.heading")).accessibilityAddTraits(.isHeader)
            }
        }
    }
}

/// 역 분기의 역 정보 섹션 안 메타 한 줄(E44 spec §3.2 1-②). 조회 전·null이면 행 없음.
struct StationMetaLine: View {
    let model: StationSectionsModel

    var body: some View {
        if let meta = model.meta {
            StationMetaText(meta: meta)
        }
    }
}

/// 역 메타 한 줄 — 시각·낭독이 갈리는 것은 병기뿐(ko는 둘이 같다). 한 줄=한 객체: 역명·영문명·노선·환승·운영기관.
/// en 계열은 역명을 병기 `Gangnam (강남)`(낭독은 영문만 — a11y 감사 #3)하고 노선은 서버 영문(`linesEn`, E27).
struct StationMetaText: View {
    let meta: StationMeta

    var body: some View {
        let isEn = AppLanguage.dataLocale == "en"
        let lines = TransitDisplay.pickLine(
            isEn: isEn, ko: meta.lines.joined(separator: ", "),
            enParts: [meta.linesEn?.joined(separator: ", ")]) { $0[0] }
        let tail = joinText(lines, meta.isTransfer ? appLocalized("stationMeta.transfer") : nil, meta.operatorName)
        if isEn {
            let b = bilingualName(lang: AppLanguage.current, ko: meta.name, en: meta.nameEn, roman: nil)
            Text(joinText(b.display, tail)).accessibilityLabel(Text(joinText(b.primary, tail)))
        } else {
            Text(joinText(appLocalized("ios.station.nameSuffixed", meta.name), meta.nameEn, tail))
        }
    }
}

/// 역 자동 섹션 — 실시간 도착·첫차막차·교통약자 시설 2종. 자동 등장 보조 정보라 로딩 표시·통지 없음(조용히 나타남),
/// 각 섹션 헤더의 heading이 유일한 발견 경로(접근성 헌장 §3, .isHeader 필수). 로드 트리거는 PlaceDetailView의 .task.
/// 교통약자 시설(서울 지하철)은 종류마다 접는다(E44 spec §4) — 천호역 72행이 접힘 행 7개가 된다.
struct StationDetailSections: View {
    let model: StationSectionsModel
    /// 펼친 시설 종류(뷰 수명, 영속 안 함). 장소가 바뀌면 새 뷰라 비어서 시작한다.
    @State private var expandedKinds: Set<String> = []

    var body: some View {
```

(b) 기존 `if let facilities = model.metroFacilities { Section { … } header: { … } }` 블록 전체를 교체:

```swift
        if let facilities = model.metroFacilities {
            Section {
                // 보강 소스(OA-21212) 실패는 은폐하지 않고 문장으로 — 어느 종류를 펼칠지 고르기 전에 알아야 한다(spec §4).
                if facilities.supplementFailed == true {
                    Text(appLocalized("subway.supplementFailed"))
                }
                ForEach(facilities.groups, id: \.kind) { group in
                    // 접힘 행이 곧 개수 줄이다. 펼친 뒤 커서는 이 행에 남고 다음 스와이프가 첫 시설(포커스 코드 없음).
                    DisclosureGroup(isExpanded: expansion(for: group.kind)) {
                        ForEach(Array(group.facilities.enumerated()), id: \.offset) { _, facility in
                            Text(joinText(
                                facilityName(facility), facility.location, facility.floors,
                                operatingStatusText(facility.operatingStatus), facilityDetail(facility)))
                        }
                        // 음성유도기 데이터 기준일 고지(정적 seed) — 그 묶음을 펼친 사람에게만 의미가 있다.
                        if group.kind == "voiceGuide" {
                            Text(appLocalized("subway.voiceGuideSource"))
                        }
                    } label: {
                        Text(kindLabel(group))
                    }
                }
            } header: {
                Text(appLocalized("ios.station.seoulFacilities")).accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// 종류별 펼침 바인딩.
    private func expansion(for kind: String) -> Binding<Bool> {
        Binding(
            get: { expandedKinds.contains(kind) },
            set: { expanded in
                if expanded { expandedKinds.insert(kind) } else { expandedKinds.remove(kind) }
            })
    }

    /// 접힘 행 라벨 — 운행 중지가 있으면 그 수를 같은 줄에(spec §4, 리뷰 M8: 접으면 줄마다 보이던 "운행 중지"가 가려진다).
    private func kindLabel(_ group: SeoulMetroFacilityGroup) -> String {
        let stopped = group.facilities.filter { $0.operatingStatus == "stopped" }.count
        if stopped > 0 {
            return appLocalized(
                "ios.station.kindCountStopped", metroKindLabel(group.kind), group.facilities.count, stopped)
        }
        return appLocalized("ios.station.kindCount", metroKindLabel(group.kind), group.facilities.count)
    }
```

(c) 기존 `private func metaLine(_ meta: StationMeta) -> some View { … }`와 그 위 주석 두 줄(`/// 첫차·막차 한 편성의 …`부터 `/// 역 메타 한 줄 — …`까지 중 메타 줄 설명)을 지운다 — `StationMetaText`로 옮겼다. `trainText` 설명 주석은 `trainText` 위로 옮겨 남긴다.

- [ ] **Step 3: 호출부 컴파일 유지(임시)**

`ios/Gildongmu/PlaceDetailView.swift`의

```swift
            if isStation(place) {
                StationSectionsView(model: stationSections)
            }
```
를
```swift
            if isStation(place) {
                StationMetaSection(model: stationSections)
                StationDetailSections(model: stationSections)
            }
```
로 바꾼다(태스크 5가 이 파일을 전면 개편한다).

- [ ] **Step 4: 가드·컴파일 확인**

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts`
Expected: 4 passed.

Run: 앱 컴파일(Global Constraints의 Experimental 명령)
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/__tests__/station-detail-guard.test.ts && git commit -m "feat(ios): 역 섹션 분리(메타 섹션·메타 줄·상세 섹션) + 교통약자 시설 종류별 접기·운행 중지 수 (E44)

<attribution 줄>" -- ios/Gildongmu/StationSections.swift ios/Gildongmu/PlaceDetailView.swift src/lib/__tests__/station-detail-guard.test.ts
git show HEAD --stat
```

---

### Task 4: 앱 저장소 `StationPhoneStore`

**Files:**
- Create: `ios/Gildongmu/StationPhoneStore.swift`
- Modify: `src/lib/__tests__/station-detail-guard.test.ts`(describe 추가)

**Interfaces:**
- Consumes: 태스크 1의 `StationPhoneService`·`StationPhoneResult`·`stationNameKey`·`subwayLineIdentity`, `TransitLegStop`, `AppConfig.apiBaseURL`.
- Produces:
  - `@Observable @MainActor final class StationPhoneStore { static let shared }`
  - `func result(stationName: String, lat: Double, lng: Double, lineName: String) -> StationPhoneResult?` — nil = 아직 모름(조회 전·조회 중·5분 경과)
  - `@discardableResult func resolve(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult`
  - `func prefetch(stops: [TransitLegStop], lineName: String)`

- [ ] **Step 1: 실패하는 소스 가드 추가**

`src/lib/__tests__/station-detail-guard.test.ts` 끝에 추가:

```ts
describe("경유역 전화번호 저장소 (spec §5.3·§5.6)", () => {
  const STORE = read("ios/Gildongmu/StationPhoneStore.swift");
  const KIT = read("ios/GildongmuKit/Sources/GildongmuKit/StationPhone.swift");

  it("메모리만 쓴다 — 영속 API 0", () => {
    expect(STORE).not.toMatch(/UserDefaults|AppStorage|FileManager|\.write\(to:|NSCache/);
  });

  it("번호·없음은 5분 보관, 실패는 신선도 기록을 남기지 않는다", () => {
    expect(STORE).toContain("static let freshSeconds: TimeInterval = 300");
    expect(STORE).toContain("fetchedAt[key] = value == .failed ? nil : Date()");
  });

  it("조회 서비스는 장소 트랙만 부른다(주소·유료 웹검색 0) — 3초 상한", () => {
    expect(KIT).toContain('client.get("/api/places", query: query, timeout: 3)');
    expect(KIT).not.toMatch(/\/api\/address\/search|\/api\/search\/web/);
  });
});
```

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts`
Expected: FAIL(파일 없음).

- [ ] **Step 2: 구현**

`ios/Gildongmu/StationPhoneStore.swift`:

```swift
import Foundation
import Observation
import GildongmuKit

/// 경유역 전화번호 조회 결과 저장소(E44 spec §5.6). 역 상세 전화 줄과 경유역 행 로터가 같은 키로 공유한다.
///
/// - 메모리만. "번호·없음"은 5분 보관(서버 `kakao-local` 캐시 300초와 같은 수명 — 몇 시간 사는 안내 세션에서
///   카카오 결과를 무기한 들고 있지 않는다), 실패는 표시용으로만 두고 신선도를 기록하지 않아 다음 조회가 재시도한다.
/// - 같은 키 진행 중 조회는 공유한다. 조회 Task는 소비자와 무관한 비구조적 Task라 소비자가 사라져도 취소되지 않는다.
/// - ⚠ `results`만 관찰 대상이다. 시트 본문은 이것을 읽지 않는다 — 경유역 행 하위 뷰와 역 상세만 읽는다(spec §6).
@Observable @MainActor
final class StationPhoneStore {
    static let shared = StationPhoneStore()

    struct Key: Hashable {
        let station: String
        let line: String
        let lat: Int
        let lng: Int
    }

    static let freshSeconds: TimeInterval = 300

    private(set) var results: [Key: StationPhoneResult] = [:]
    @ObservationIgnored private var fetchedAt: [Key: Date] = [:]
    @ObservationIgnored private var inflight: [Key: Task<StationPhoneResult, Never>] = [:]
    @ObservationIgnored private let service = StationPhoneService(client: APIClient(baseURL: AppConfig.apiBaseURL))

    /// 노선 표가 모르는 노선이면 nil — 그 역은 조회하지 않고 "없음"이다(spec §5.4-4).
    static func key(stationName: String, lat: Double, lng: Double, lineName: String) -> Key? {
        let station = stationNameKey(stationName)
        guard !station.isEmpty, let line = subwayLineIdentity(lineName) else { return nil }
        return Key(
            station: station, line: line,
            lat: Int((lat * 10_000).rounded()), lng: Int((lng * 10_000).rounded()))
    }

    /// 표시용 현재 값. nil = 아직 모름(조회 전·조회 중·5분 경과). 실패는 다음 조회 전까지 `.failed`로 보인다.
    func result(stationName: String, lat: Double, lng: Double, lineName: String) -> StationPhoneResult? {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        guard let value = results[key] else { return nil }
        if value == .failed { return .failed }
        guard let at = fetchedAt[key], Date().timeIntervalSince(at) < Self.freshSeconds else { return nil }
        return value
    }

    @discardableResult
    func resolve(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        if let value = results[key], value != .failed,
           let at = fetchedAt[key], Date().timeIntervalSince(at) < Self.freshSeconds {
            return value
        }
        if let running = inflight[key] { return await running.value }
        let service = self.service
        let task = Task {
            await service.lookup(stationName: stationName, lat: lat, lng: lng, lineName: lineName)
        }
        inflight[key] = task
        let value = await task.value
        inflight[key] = nil
        results[key] = value
        fetchedAt[key] = value == .failed ? nil : Date()
        return value
    }

    /// 경유역 목록을 펼치는 순간 그 구간 역 전부를 미리 조회한다(spec §6, 리뷰 M6 — 행 실현 시 조회는 액션이 조용히 늦게 생긴다).
    func prefetch(stops: [TransitLegStop], lineName: String) {
        for stop in stops {
            Task { await resolve(stationName: stop.name, lat: stop.lat, lng: stop.lng, lineName: lineName) }
        }
    }
}
```

- [ ] **Step 3: 가드·컴파일 확인**

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts` → Expected: 전부 PASS.
Run: 앱 컴파일(Experimental) → Expected: `** BUILD SUCCEEDED **`(Swift 6 동시성 경고가 새로 나면 원인을 고친다 — `Task` 캡처는 `service` 지역 상수로 이미 분리했다).

- [ ] **Step 4: 커밋**

```bash
git add ios/Gildongmu/StationPhoneStore.swift && git commit -m "feat(ios): 경유역 전화번호 저장소 — 메모리 5분·실패 비보관·진행 중 공유·펼침 일괄 조회 (E44)

<attribution 줄>" -- ios/Gildongmu/StationPhoneStore.swift src/lib/__tests__/station-detail-guard.test.ts
git show HEAD --stat
```

---

### Task 5: `PlaceDetailView` 역 분기 레이아웃

**Files:**
- Modify: `ios/Gildongmu/PlaceDetailView.swift`(전면)
- Modify: `src/lib/__tests__/place-detail-sheet-guard.test.ts`(구조체 판정 방식)
- Modify: `src/lib/__tests__/station-detail-guard.test.ts`(describe 추가)

**Interfaces:**
- Consumes: 태스크 1 `stationLayoutKind`·`isRepresentativePhone`·`StationPhoneResult`, 태스크 3 `StationMetaSection`·`StationMetaLine`·`StationDetailSections`, 태스크 4 `StationPhoneStore`, 태스크 2 키.
- Produces:
  - `PlaceDetailView`에 `var stationLineHint: String? = nil`(편의 init 인자 `stationLineHint: String? = nil`)
  - `PlaceDetailSheet`에 `var stationLineHint: String? = nil`(태스크 6이 넘긴다)

- [ ] **Step 1: 기존 가드의 구조체 판정을 창 크기와 무관하게 고친다**

`src/lib/__tests__/place-detail-sheet-guard.test.ts`에서 `precedingCode(lines, i, 8)`로 `struct PlaceDetailSheet`를 찾는 부분을 "호출 줄을 감싸는 가장 가까운 struct 선언"으로 바꾼다:

```ts
/** 호출 줄을 감싸는 가장 가까운 `struct` 선언 이름(들여쓰기 0의 선언만 — 파일 최상위 뷰). */
function enclosingStruct(lines: string[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const m = lines[i].match(/^(?:private |fileprivate )?struct (\w+)/);
    if (m) return m[1];
  }
  return null;
}
```
그리고 판정 줄을
```ts
        if (enclosingStruct(lines, i) === "PlaceDetailSheet") {
```
로 바꾼다(`precedingCode` 함수는 push 판정에 계속 쓴다).

Run: `npx vitest run src/lib/__tests__/place-detail-sheet-guard.test.ts` → Expected: 2 passed(아직 코드 무변경).

- [ ] **Step 2: 실패하는 레이아웃 가드 추가**

`src/lib/__tests__/station-detail-guard.test.ts` 끝에 추가:

```ts
describe("역 장소 상세 레이아웃 (spec §3)", () => {
  const VIEW = read("ios/Gildongmu/PlaceDetailView.swift");
  const bodyStart = VIEW.indexOf("var body: some View {");
  const stationStart = VIEW.indexOf("if let kind = layoutKind {", bodyStart);
  const elseStart = VIEW.indexOf("} else {", stationStart);
  const elseEnd = VIEW.indexOf("\n            }\n", elseStart);
  const station = VIEW.slice(stationStart, elseStart);
  const general = VIEW.slice(elseStart, elseEnd);
  const order = (src: string, marks: string[]) => marks.map((m) => {
    const at = src.indexOf(m);
    expect(at, m).toBeGreaterThan(-1);
    return at;
  });

  it("역 분기 순서: 역 정보 → 상세 섹션(도착·시간표·시설) → 무장애 → 길찾기 → 이 장소 주변", () => {
    const at = order(station, [
      "stationInfoSection(kind)",
      "StationDetailSections(model: stationSections)",
      "BarrierFreeInfoSection(model: barrierFreeInfo)",
      "routeSection",
      "nearbySection(includesSubway: false)",
    ]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("현행 분기 순서는 개편 전 그대로: 기본 정보 → 길찾기 → 이 장소 주변(지하철 포함) → 역 섹션 → 무장애", () => {
    const at = order(general, [
      "generalInfoSection",
      "routeSection",
      "nearbySection(includesSubway: true)",
      "StationMetaSection(model: stationSections)",
      "StationDetailSections(model: stationSections)",
      "BarrierFreeInfoSection(model: barrierFreeInfo)",
    ]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("지하철 도착 링크는 includesSubway가 참일 때만", () => {
    const nearby = VIEW.slice(VIEW.indexOf("private func nearbySection("));
    expect(nearby.slice(0, nearby.indexOf("SubwayNearbyView"))).toContain("if includesSubway");
  });

  it("역 정보 섹션: 전화 줄이 첫 행, 메타 줄이 다음, 분류 줄은 .rail만, 제목은 항상", () => {
    const info = VIEW.slice(VIEW.indexOf("private func stationInfoSection("), VIEW.indexOf("private var stationPhoneRow"));
    const at = order(info, ["stationPhoneRow", "StationMetaLine(model: stationSections)", "if kind == .rail"]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(info).toContain('Text(appLocalized("stationMeta.heading")).accessibilityAddTraits(.isHeader)');
  });

  it("전화 줄: 대표번호 표기·조회 실패 줄·조회는 경유역만", () => {
    expect(VIEW).toContain('appLocalized("ios.place.callRepresentativeLine", phone)');
    expect(VIEW).toContain('appLocalized("ios.station.phoneError")');
    const lookup = VIEW.slice(VIEW.indexOf("private func lookupStationPhoneIfNeeded("));
    expect(lookup.slice(0, lookup.indexOf("\n    }\n"))).toContain('place.id.hasPrefix("transit-stop:")');
  });

  it("길찾기 제목은 명시 heading이다(화면 아래로 내려가 제목 점프 의존이 커진다)", () => {
    const route = VIEW.slice(VIEW.indexOf("private var routeSection"));
    expect(route.slice(0, route.indexOf("\n    }\n"))).toContain(
      'Text(appLocalized("ios.route.section")).accessibilityAddTraits(.isHeader)',
    );
  });
});
```

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts`
Expected: 새 describe FAIL.

- [ ] **Step 3: `PlaceDetailView.swift` 전면 교체**

`struct PlaceDetailView`부터 파일 끝까지를 아래로 바꾼다(`PlaceDetailSheet`·편의 init 포함). 딥링크·카카오 헬퍼 본문은 기존과 같다.

```swift
import SwiftUI
import GildongmuKit

/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
/// domainSection: 도메인 전용 최상단 섹션(내 주변 소아 진료 등) — 그 화면에 온 이유이므로 서열 1위.
///
/// **레이아웃은 둘이다**(E44 spec `2026-09-17-station-detail-reorg-design.md` §3). `stationLayoutKind`가 역(지하철·기차역
/// POI, 경유역)이면 역 정보 → 도착·시간표·교통약자 시설(종류별 접기) → 무장애 → 길찾기 → 이 장소 주변(지하철 없음),
/// 그 밖이면 개편 전 순서 그대로다. ⚠ 넓은 `isStation`으로 레이아웃을 고르지 말 것 — 출구 POI·"철도" 업체·이름만
/// "역"으로 끝나는 장소가 역 모양이 된다(설계 리뷰 M2). 역 섹션 **로드**는 종전대로 `isStation`이다.
struct PlaceDetailView<DomainSection: View>: View {
    let place: Place
    /// 표시용 분류(A28) — 채팅 컨텍스트·역 판정은 `place.category` 원문 그대로.
    private var displayCategory: String {
        pickCategory(lang: AppLanguage.current, category: place.category, categoryEn: place.categoryEn)
    }
    /// 길찾기 프리필 진입 버튼 노출 여부(기본 표시). 안내 시트의 "장소 상세 보기"
    /// 문맥에서만 숨긴다 — 이미 그곳으로 안내 중이라 무의미하고, 누르면 시트 뒤
    /// 길찾기 폼을 조작해 보이지 않는 상태 변화를 만든다(스펙 2026-08-12 §2).
    var showsDirectionsEntry: Bool = true
    /// "이 장소에 관해 물어보기" 노출 여부(기본 표시). 채팅 안에서 연 상세(카드·산문
    /// 액션)에서만 숨긴다 — 채팅 위에 새 채팅 시트를 쌓는 재진입 순환 방지.
    var showsChatEntry: Bool = true
    /// 경유역 전화번호 조회의 노선 힌트(E44 spec §5.2) — 대중교통 안내 시트가 경유역을 열 때만, 누르는 순간 확정한
    /// leg `lineName`을 넘긴다. 그 밖의 상세는 nil(자기 `phone`이 전부다).
    var stationLineHint: String? = nil
    @ViewBuilder var domainSection: () -> DomainSection
    @Environment(\.openURL) private var openURL
    /// 역 자동 섹션 모델. 로드는 아래 .task에서 킥오프(역일 때만)
    @State private var stationSections = StationSectionsModel()
    private let guideSession = GuideSession.shared
    private let phoneStore = StationPhoneStore.shared
    /// 무장애 편의시설 자동 섹션 모델. 역 여부와 무관하게 모든 장소에서 로드
    @State private var barrierFreeInfo = BarrierFreeInfoModel()
    /// 영업시간 한 줄(E24).
    @State private var placeHours = PlaceHoursModel()
    /// 장소 채팅 sheet(M5). 표시마다 새 ChatView = 장소마다 새 대화(웹 계약)
    @State private var isChatPresented = false

    /// 비-ko 병기(E28). 내비게이션 타이틀은 접근 라벨을 따로 줄 수 없어 1순위 이름만 쓰고,
    /// 한글 원문은 바로 아래 보조 줄에 시각 전용(`accessibilityHidden`)으로 둔다.
    private var bilingualTitle: BilingualName { bilingual(place.name, roman: place.nameRoman) }

    private var layoutKind: StationLayoutKind? { stationLayoutKind(place) }

    var body: some View {
        List {
            if let secondary = bilingualTitle.secondary {
                Section {
                    Text(secondary)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            }
            domainSection()
            if let kind = layoutKind {
                // 역 상세(E44 §3.2). 교통약자 시설을 접어 두므로 역 섹션을 앞에 둬도 주변·길찾기까지의 거리가
                // 짧다 — 종전 "주변 먼저" 배치의 근거(펼친 수백 행)가 사라졌다. 이 장소 주변은 최하단(판정 ⑤).
                stationInfoSection(kind)
                StationDetailSections(model: stationSections)
                BarrierFreeInfoSection(model: barrierFreeInfo)
                routeSection
                nearbySection(includesSubway: false)
            } else {
                generalInfoSection
                routeSection
                nearbySection(includesSubway: true)
                // 역이면 역 정보·실시간 도착·교통약자 시설이 자동 등장(조용히 나타남, M3) — 출구 POI 등 드문 경우.
                if isStation(place) {
                    StationMetaSection(model: stationSections)
                    StationDetailSections(model: stationSections)
                }
                // 무장애 편의시설도 자동 등장(조용히 나타남, 역 여부 무관)
                BarrierFreeInfoSection(model: barrierFreeInfo)
            }
        }
        .navigationTitle(bilingualTitle.primary)
        .navigationBarTitleDisplayMode(.large)
        .task {
            if isStation(place) {
                await stationSections.load(stationName: place.name)
            }
        }
        .task {
            await barrierFreeInfo.load(lat: place.lat, lng: place.lng, name: place.name)
        }
        .task {
            await placeHours.load(place: place)
        }
        .task {
            await lookupStationPhoneIfNeeded()
        }
        .sheet(isPresented: $isChatPresented) {
            ChatView(place: place)
        }
    }

    // MARK: 현행 분기

    /// 개편 전 기본 정보 섹션(분류·주소·영업시간·전화·홈페이지·물어보기). 순서를 바꾸지 않는다.
    private var generalInfoSection: some View {
        Section {
            categoryRow
            addressRows
            // 영업시간(E24): 전화 링크 앞 — 시각이 틀릴 수 있어 확인 경로와 짝짓는다.
            PlaceHoursLine(model: placeHours)
            if let phone = place.phone, !phone.isEmpty,
               let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
                // 인터랙티브 요소는 별도 객체가 정상(합치지 말 것)
                Link(appLocalized("ios.place.callLine", phone), destination: telURL)
            }
            homepageRow
            chatRow
        }
    }

    // MARK: 역 분기

    /// 역 정보 섹션(E44 §3.2 1). 제목은 역 상세면 항상 선다. 전화 줄이 맨 위("가장 많이 쓸 메뉴", 위원장).
    private func stationInfoSection(_ kind: StationLayoutKind) -> some View {
        Section {
            stationPhoneRow
            StationMetaLine(model: stationSections)
            // 분류 줄은 기차역만 — `KTX정차역` 같은 정보가 여기뿐이다. 지하철은 합성값이거나 메타 줄 노선과 중복.
            if kind == .rail { categoryRow }
            addressRows
            PlaceHoursLine(model: placeHours)
            homepageRow
            chatRow
        } header: {
            Text(appLocalized("stationMeta.heading")).accessibilityAddTraits(.isHeader)
        }
    }

    /// 전화 줄(E44 §5.5): 자기 번호가 있으면 그것, 경유역이면 조회 결과. 대표번호는 밝힌다(판정 ⑥),
    /// 조회 실패는 없음과 가른다(3-state). 줄은 조용히 나타난다(자동 등장 보조 정보, 통지 없음).
    @ViewBuilder private var stationPhoneRow: some View {
        if let phone = place.phone, !phone.isEmpty {
            stationPhoneLink(phone)
        } else if let line = stationLineHint, place.id.hasPrefix("transit-stop:") {
            switch phoneStore.result(stationName: place.name, lat: place.lat, lng: place.lng, lineName: line) {
            case .direct(let phone)?, .representative(let phone)?:
                stationPhoneLink(phone)
            case .failed?:
                Text(appLocalized("ios.station.phoneError"))
            case .unavailable?, nil:
                EmptyView()
            }
        }
    }

    @ViewBuilder private func stationPhoneLink(_ phone: String) -> some View {
        if let telURL = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
            if isRepresentativePhone(phone) {
                Link(appLocalized("ios.place.callRepresentativeLine", phone), destination: telURL)
            } else {
                Link(appLocalized("ios.place.callLine", phone), destination: telURL)
            }
        }
    }

    /// 경유역만 조회한다(E44 §5.2) — 검색 탭·채팅에서 연 역은 이미 카카오 POI라 다시 찾아도 같다.
    private func lookupStationPhoneIfNeeded() async {
        guard (place.phone ?? "").isEmpty, place.id.hasPrefix("transit-stop:"), let line = stationLineHint else { return }
        await phoneStore.resolve(stationName: place.name, lat: place.lat, lng: place.lng, lineName: line)
    }

    // MARK: 공용 행·섹션

    /// 한 줄=한 객체: 라벨 볼드 분절 대신 단일 텍스트(웹 정본 규칙). 분류는 비-ko에서 서버 영문(categoryEn, A28)을
    /// 우선한다. 영문이 없어 한국어가 남는 폴백에만 언어 태깅 후보 ①(KoreanText, 실기기 판정 항목).
    @ViewBuilder private var categoryRow: some View {
        if !displayCategory.isEmpty {
            if AppLanguage.current != "ko", hasHangul(displayCategory) {
                KoreanText(displayCategory)
            } else {
                Text(displayCategory)
            }
        }
    }

    /// 주소는 종류마다 "줄 + 그 줄 전용 복사 버튼"을 인접 배치한다(택배·행정서식은 지번 필요, 웹 동형).
    /// 보유한 주소만 낸다(빈 주소 = 죽은 버튼). 인터랙티브는 텍스트와 합치지 않는다.
    @ViewBuilder private var addressRows: some View {
        if !place.roadAddress.isEmpty {
            Text(appLocalized("ios.place.roadAddressLine", place.roadAddress))
            Button(appLocalized("place.copyRoadAddress")) { copyAddressToPasteboard(place.roadAddress) }
        }
        if !place.address.isEmpty {
            Text(appLocalized("ios.place.jibunAddressLine", place.address))
            Button(appLocalized("place.copyJibunAddress")) { copyAddressToPasteboard(place.address) }
        }
        if let english = place.englishAddress, !english.isEmpty {
            Text(appLocalized("ios.place.englishAddressLine", english))
            Button(appLocalized("place.copyEnglishAddress")) { copyAddressToPasteboard(english) }
        }
    }

    /// 홈페이지(비카카오 link 보유 장소만, 웹 RouteLinks 미러) — 카카오 장소의 link는 카카오맵 장소 상세라
    /// 아래 '카카오맵 장소 정보'와 중복(노출 금지).
    @ViewBuilder private var homepageRow: some View {
        if kakaoPlaceId == nil, let link = place.link, let linkURL = URL(string: link) {
            Link(appLocalized("place.homepage"), destination: linkURL)
        }
    }

    @ViewBuilder private var chatRow: some View {
        if showsChatEntry {
            Button(appLocalized("placeChat.launch")) { isChatPresented = true }
        }
    }

    /// 길찾기 섹션. 제목은 명시 heading(E44 §3.2 7 — 역 상세에선 화면 아래로 내려가 제목 점프 의존이 커진다).
    private var routeSection: some View {
        Section {
            // 길찾기 탭으로 도착지 프리필 진입(Task I4) — 출발 전 미리 듣기는 이 3수단 비교로 일원화.
            // 두 버튼은 별개 접근성 객체다 — 라벨이 각각 동작의 범위를 말한다. "여기부터"는 도착지 입력으로 착지(E32).
            if showsDirectionsEntry {
                Button(appLocalized("directions.toHere")) {
                    DirectionsPrefillStore.shared.pending = DirectionsPrefill(
                        role: .to, endpoint: .place(label: place.name, lat: place.lat, lng: place.lng))
                }
                Button(appLocalized("directions.fromHere")) {
                    DirectionsPrefillStore.shared.pending = DirectionsPrefill(
                        role: .from, endpoint: .place(label: place.name, lat: place.lat, lng: place.lng))
                }
            }
            // 안내 중에만(N1 spec §2.5): 진행 중인 세션의 목적지를 이 장소로 바꾼다. 비콘은 같은 세션의 경로 재획득,
            // 대중교통은 2단(후보 선택)이라 준비만 하고 통지한다 — 시트를 자동으로 올리지 않는다(설계 리뷰 M3).
            if showsDirectionsEntry, guideSession.beacon.isTracking || guideSession.transit.isTracking {
                Button(appLocalized("guide.changeDestHere")) {
                    let dest = BeaconDest(lat: place.lat, lng: place.lng)
                    if guideSession.beacon.isTracking {
                        if guideSession.beacon.changeDestination(dest: dest, label: place.name) {
                            GuideFormSyncStore.shared.post(.place(label: place.name, lat: place.lat, lng: place.lng))
                        }
                    } else {
                        guideSession.transit.prepareDestinationChange(dest: dest, label: place.name)
                        guideSession.beacon.announceNow(
                            appLocalized("guide.transitDestChangePrepared"),
                            highPriority: true, bypassSuppression: true)
                    }
                }
                // 경유지 추가·변경(N4 spec §4.5): 동작이 교체라 기존 경유지가 있으면 라벨이 그것을 말한다.
                if guideSession.waypointAvailable {
                    Button(appLocalized(
                        guideSession.beacon.waypoint == nil ? "guide.addWaypointHere" : "guide.changeWaypointHere"
                    )) {
                        if guideSession.beacon.setWaypoint(
                            dest: BeaconDest(lat: place.lat, lng: place.lng), label: place.name
                        ) {
                            GuideFormSyncStore.shared.postWaypoint(
                                .place(label: place.name, lat: place.lat, lng: place.lng))
                        }
                    }
                }
            }
            Button(appLocalized("ios.route.naver")) { openNaverRoute() }
            Button(appLocalized("ios.route.kakao")) { openKakaoRoute() }
            if let kakaoId = kakaoPlaceId {
                Button(appLocalized("ios.route.kakaoPlace")) { openKakaoPlace(kakaoId) }
            }
        } header: {
            Text(appLocalized("ios.route.section")).accessibilityAddTraits(.isHeader)
        }
    }

    /// "이 장소 주변" — 내 주변 화면을 장소 좌표로 앵커해 push. 인라인 복제 대신 push인 이유: 기존 화면의 새로고침·
    /// 상태 오버레이·완료 통지 계약이 그대로 따라오고 상세가 짧게 유지된다. 발견 경로는 섹션 heading.
    /// 역 상세는 지하철 도착 행을 뺀다(E44 판정 ④ — 같은 역 도착이 위 "실시간 도착"에 이미 있고, 역 상세끼리는
    /// 구성이 같다). 그 밖의 장소는 종전 4종(이용 빈도순, 지하철 먼저).
    private func nearbySection(includesSubway: Bool) -> some View {
        Section {
            if includesSubway {
                NavigationLink(appLocalized("ios.nearby.subway")) { SubwayNearbyView(anchor: anchor) }
            }
            NavigationLink(appLocalized("ios.nearby.bus")) { BusNearbyView(anchor: anchor) }
            NavigationLink(appLocalized("ios.nearby.bike")) { BikeNearbyView(anchor: anchor) }
            NavigationLink(appLocalized("ios.nearby.conditions")) { ConditionsView(anchor: anchor) }
        } header: {
            Text(appLocalized("ios.place.nearbyHeading")).accessibilityAddTraits(.isHeader)
        }
    }

    /// Place.id "kakao-" 접두가 있을 때만 카카오 장소 상세 체인 유효(웹 계약)
    private var kakaoPlaceId: String? {
        place.id.hasPrefix("kakao-") ? String(place.id.dropFirst("kakao-".count)) : nil
    }

    private var destination: RouteDestination {
        RouteDestination(lat: place.lat, lng: place.lng, name: place.name)
    }

    /// "이 장소 주변" 화면들이 쓰는 앵커(현재 위치 대신 이 장소 고정).
    private var anchor: PlaceAnchor {
        PlaceAnchor(coord: (lat: place.lat, lng: place.lng), name: place.name, nameRoman: place.nameRoman)
    }

    /// 도보 기본(1급 사용자 주 시나리오).
    private func openNaverRoute() {
        guard let url = buildNaverRouteDeeplink(mode: .walk, dest: destination, appname: AppConfig.appIdentifier) else { return }
        openWithFallback(url)
    }

    private func openKakaoRoute() {
        guard let url = buildKakaoRouteDeeplink(mode: .walk, dest: destination) else { return }
        openWithFallback(url)
    }

    private func openKakaoPlace(_ id: String) {
        guard let url = buildKakaoPlaceDeeplink(kakaoPlaceId: id) else { return }
        // 앱 미설치 폴백은 같은 장소의 카카오맵 웹 상세로(경로 폴백은 다른 화면이라 오동작)
        openURL(url) { accepted in
            if !accepted, let fallback = URL(string: "https://place.map.kakao.com/\(id)") {
                openURL(fallback)
            }
        }
    }

    /// 앱 미설치(스킴 미처리) 시 카카오 웹 지도로 폴백. canOpenURL 화이트리스트 불필요.
    private func openWithFallback(_ url: URL) {
        openURL(url) { accepted in
            if !accepted, let fallback = buildKakaoWebRouteUrl(mode: .walk, dest: destination) {
                openURL(fallback)
            }
        }
    }
}

/// 시트로 띄운 장소 상세 — 닫기 버튼을 단다(시트 툴바 관례 `.cancellationAction`, `ChatView` 동형).
/// ⚠ 시트 안에 장소 상세를 넣는 자리는 전부 이것을 지난다 — 아래로 쓸기·VO 문지르기만 남기면 스크린 리더
/// 사용자는 빠져나오는 수단을 찾지 못한다(2026-09-16 실승차: 안내 시트의 역 상세에서 닫기를 못 찾았다).
/// push(`NavigationLink`·`navigationDestination`)는 뒤로 버튼이 있어 해당 없다. 가드 `place-detail-sheet-guard.test.ts`.
struct PlaceDetailSheet: View {
    let place: Place
    var showsDirectionsEntry: Bool = true
    var showsChatEntry: Bool = true
    var stationLineHint: String? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PlaceDetailView(
                place: place, showsDirectionsEntry: showsDirectionsEntry, showsChatEntry: showsChatEntry,
                stationLineHint: stationLineHint)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(appLocalized("actions.close")) { dismiss() }
                    }
                }
        }
    }
}

/// 기존 호출처(`PlaceDetailView(place:)`) 무변경 컴파일용 편의 init — 도메인 섹션 없음.
extension PlaceDetailView where DomainSection == EmptyView {
    init(
        place: Place, showsDirectionsEntry: Bool = true, showsChatEntry: Bool = true,
        stationLineHint: String? = nil
    ) {
        self.init(
            place: place, showsDirectionsEntry: showsDirectionsEntry,
            showsChatEntry: showsChatEntry, stationLineHint: stationLineHint, domainSection: { EmptyView() })
    }
}
```

⚠ 교체 전 원본 파일과 대조해 **현행 분기의 행·조건이 한 줄도 빠지지 않았는지** 확인한다: `git diff ios/Gildongmu/PlaceDetailView.swift`에서 삭제된 코드 줄이 새 파일에 같은 뜻으로 있는지(주석 정리는 허용). 특히 `guide.changeDestHere`·`guide.addWaypointHere` 블록, `ios.route.kakaoPlace`, `PlaceHoursLine` 위치.
⚠ `domainSection` 멤버와이즈 init 인자 순서: 제네릭 구조체의 합성 init은 저장 프로퍼티 선언 순서를 따른다 — `stationLineHint`를 `showsChatEntry` 뒤·`domainSection` 앞에 선언했으므로 `ClinicNearbyView`·`EventsNearbyView`의 `PlaceDetailView(place:) { … }` 트레일링 클로저 호출은 그대로 컴파일된다(기본값 인자는 생략 가능).

- [ ] **Step 4: 가드·컴파일 확인**

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts src/lib/__tests__/place-detail-sheet-guard.test.ts src/lib/__tests__/place-hours-tts-drift.test.ts`
Expected: 전부 PASS.
Run: 앱 컴파일 Experimental·Release 둘 다 → `** BUILD SUCCEEDED **`.
Run: `node ios/scripts/check-xcstrings-keys.mjs` → exit 0.

- [ ] **Step 5: 변이 주입(가드 검출력)**

역 분기의 `nearbySection(includesSubway: false)`를 `true`로 바꾼 사본으로 가드가 실패하는지 본다:

```bash
cp ios/Gildongmu/PlaceDetailView.swift /tmp/claude-pdv.bak
sed -i '' 's/nearbySection(includesSubway: false)/nearbySection(includesSubway: true)/' ios/Gildongmu/PlaceDetailView.swift
npx vitest run src/lib/__tests__/station-detail-guard.test.ts 2>&1 | grep -E "Tests"
cp /tmp/claude-pdv.bak ios/Gildongmu/PlaceDetailView.swift
npx vitest run src/lib/__tests__/station-detail-guard.test.ts 2>&1 | grep -E "Tests"
```
Expected: 변이 사본 1 failed 이상, 원복 뒤 전부 passed.

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(ios): 역 장소 상세 레이아웃 — 역 정보(전화 맨 위·대표번호·조회 실패)→도착·시간표·시설→무장애→길찾기→이 장소 주변(지하철 제외), 현행 분기 순서 불변 (E44)

<attribution 줄>" -- ios/Gildongmu/PlaceDetailView.swift src/lib/__tests__/station-detail-guard.test.ts src/lib/__tests__/place-detail-sheet-guard.test.ts
git show HEAD --stat
```

---

### Task 6: 안내 시트 경유역 행 — 로터 "전화 걸기"·펼침 일괄 조회·노선 힌트 확정

**Files:**
- Modify: `ios/Gildongmu/Directions/TransitTrackingSheet.swift`
- Modify: `src/lib/__tests__/station-detail-guard.test.ts`(describe 추가)

**Interfaces:**
- Consumes: 태스크 4 `StationPhoneStore.shared.result/resolve/prefetch`, 태스크 5 `PlaceDetailSheet(place:showsDirectionsEntry:stationLineHint:)`, 태스크 2 `ios.place.callRepresentative`, `TransitGuideLeg.lineName: String`.
- Produces: 없음(최종 소비자).

- [ ] **Step 1: 실패하는 가드 추가**

`src/lib/__tests__/station-detail-guard.test.ts` 끝에 추가:

```ts
describe("안내 시트 경유역 로터 (spec §5.2·§6)", () => {
  const SHEET = read("ios/Gildongmu/Directions/TransitTrackingSheet.swift");
  const row = structBody(SHEET, "ViaStopStationRow");

  it("경유역 행 하위 뷰만 저장소를 읽고, 로터는 직통·대표번호 라벨을 가른다", () => {
    expect(row).toContain("phoneStore.result(stationName: stop.name");
    expect(row).toContain('Button(appLocalized("ios.place.call"))');
    expect(row).toContain('Button(appLocalized("ios.place.callRepresentative"))');
    const sheetBody = SHEET.slice(0, SHEET.indexOf("private struct ViaStopStationRow"));
    expect(sheetBody).not.toContain("phoneStore.result(");
  });

  it("목록을 펼치는 순간 그 구간 역을 일괄 조회한다", () => {
    expect(SHEET).toMatch(/\.onChange\(of: viaExpanded\) \{ _, expanded in\s+if expanded \{ prefetchViaPhones\(\) \}/);
    const fn = SHEET.slice(SHEET.indexOf("private func prefetchViaPhones("));
    expect(fn.slice(0, fn.indexOf("\n    }\n"))).toContain(
      "StationPhoneStore.shared.prefetch(stops: leg.viaStops, lineName: leg.lineName)",
    );
  });

  it("노선 힌트는 누르는 순간 확정해 상세와 함께 나른다 — 목적지 상세는 nil", () => {
    const open = SHEET.slice(SHEET.indexOf("private func openStationDetail("));
    expect(open.slice(0, open.indexOf("\n    }\n"))).toContain("detailLineHint = lineName");
    expect(SHEET).toContain("detailLineHint = nil");
    expect(SHEET).toContain("PlaceDetailSheet(place: place, showsDirectionsEntry: false, stationLineHint: detailLineHint)");
  });
});
```

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts` → Expected: 새 describe FAIL.

- [ ] **Step 2: 구현**

(a) `@State private var detailPlace: Place?` 선언 바로 아래에 추가:

```swift
    /// 경유역 상세의 노선 힌트(E44 spec §5.2) — 행을 누르는 순간의 leg `lineName`으로 확정한다. 시트 클로저에서
    /// `currentLeg`를 읽으면 목적지 상세에도 붙고, 상세가 열린 채 구간이 바뀌면 힌트가 바뀐다(설계 리뷰 M4).
    @State private var detailLineHint: String?
```

(b) 제목 메뉴 `onShowDetail` 클로저의
```swift
                                    detailPlace = guideDestinationPlace(dest: dest, label: model.destinationLabel)
```
바로 앞 줄에 `detailLineHint = nil`을 넣는다.

(c) 장소 상세 시트 본문
```swift
                PlaceDetailSheet(place: place, showsDirectionsEntry: false)
```
를
```swift
                PlaceDetailSheet(place: place, showsDirectionsEntry: false, stationLineHint: detailLineHint)
```
로 바꾼다.

(d) `.onChange(of: model.state?.legIndex) { viaExpanded = false }` 바로 아래에 추가:

```swift
            // 경유역 목록을 펼치는 순간 그 구간 역의 전화번호를 일괄 조회한다(E44 spec §6, 리뷰 M6).
            .onChange(of: viaExpanded) { _, expanded in
                if expanded { prefetchViaPhones() }
            }
```

(e) `viaStopsRows`의 지하철 분기
```swift
                    if leg.mode == "subway" {
                        Button {
                            openStationDetail(leg.viaStops[index], source: "via")
                        } label: {
                            line.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else {
```
를
```swift
                    if leg.mode == "subway" {
                        ViaStopStationRow(stop: leg.viaStops[index], lineName: leg.lineName, label: line) {
                            openStationDetail(leg.viaStops[index], lineName: leg.lineName, source: "via")
                        }
                    } else {
```
로 바꾸고, `viaStopsRows` 주석 끝에 한 줄 추가: `/// 지하철 행의 로터 "전화 걸기"(E44)는 하위 뷰 `ViaStopStationRow`가 단다 — 저장소를 시트 본문이 읽지 않게.`

(f) `statusRows`의 로터 액션 호출 `openStationDetail(leg.viaStops[index], source: "status")`를 `openStationDetail(leg.viaStops[index], lineName: leg.lineName, source: "status")`로 바꾼다.

(g) `openStationDetail`을 교체:

```swift
    /// 지하철 경유역의 장소 상세(E33): 좌표·ID·한국어 이름으로 곧장 연다(이름 재검색 없음). 사용자 조작이라
    /// 유휴 시계를 되돌린다(E36 `touchUserAction`). 노선 힌트는 여기서 확정한다(E44 §5.2).
    private func openStationDetail(_ stop: TransitLegStop, lineName: String, source: String) {
        model.touchUserAction()
        transitGuideLog("stationDetail open station=\(stop.name) source=\(source)")
        detailLineHint = lineName
        detailPlace = transitStopPlace(stop)
    }

    /// 펼친 경유역 목록의 전화번호 일괄 조회(E44 §6). 지하철 leg만.
    private func prefetchViaPhones() {
        guard let leg = model.currentLeg, leg.mode == "subway" else { return }
        StationPhoneStore.shared.prefetch(stops: leg.viaStops, lineName: leg.lineName)
    }
```

(h) 파일 끝에 추가:

```swift
/// 지하철 경유역 행(E33 행 전체 버튼 + E44 로터 "전화 걸기"). **저장소는 이 하위 뷰만 관찰한다** — 번호 도착이
/// 시트 본문 재렌더가 되지 않게(spec §6, `rendered` 참조 상자와 같은 계열). 번호가 늦게 와도 뷰 종류는 언제나
/// 같은 `Button`이라 포커스가 튀지 않는다. 액션은 번호가 확정된 행에만(보유한 데이터만 — `PlaceRow` 관례).
private struct ViaStopStationRow: View {
    let stop: TransitLegStop
    let lineName: String
    let label: Text
    let onOpen: () -> Void
    @Environment(\.openURL) private var openURL
    private let phoneStore = StationPhoneStore.shared

    var body: some View {
        Button(action: onOpen) {
            label.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityActions {
            switch phoneStore.result(stationName: stop.name, lat: stop.lat, lng: stop.lng, lineName: lineName) {
            case .direct(let phone)?:
                Button(appLocalized("ios.place.call")) { call(phone) }
            case .representative(let phone)?:
                Button(appLocalized("ios.place.callRepresentative")) { call(phone) }
            default:
                EmptyView()
            }
        }
        // 5분이 지나 다시 실현된 행의 재조회(펼침 일괄 조회가 1차). 저장소가 중복을 막는다.
        .task(id: "\(stop.name)|\(lineName)") {
            await phoneStore.resolve(stationName: stop.name, lat: stop.lat, lng: stop.lng, lineName: lineName)
        }
    }

    private func call(_ phone: String) {
        guard let url = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") else { return }
        openURL(url)
    }
}
```

- [ ] **Step 3: 가드·컴파일 확인**

Run: `npx vitest run src/lib/__tests__/station-detail-guard.test.ts src/lib/__tests__/transit-landing-guard.test.ts src/lib/__tests__/place-detail-sheet-guard.test.ts`
Expected: 전부 PASS(`transit-landing-guard`의 E33 가드 — `openStationDetail`의 `model.touchUserAction()`·`transitStopPlace(stop)`, `.sheet(item: $detailPlace, onDismiss: {` 1회 — 그대로 성립).
Run: 앱 컴파일 Experimental·Release → `** BUILD SUCCEEDED **`.
Run: `node ios/scripts/check-xcstrings-keys.mjs` → exit 0.
Run: `npm run test:run 2>&1 | tail -5` → 전체 PASS.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(ios): 안내 시트 경유역 행 로터 \"전화 걸기\"(대표번호 표기)·펼침 일괄 조회·노선 힌트 누르는 순간 확정 (E44)

<attribution 줄>" -- ios/Gildongmu/Directions/TransitTrackingSheet.swift src/lib/__tests__/station-detail-guard.test.ts
git show HEAD --stat
```

---

### Task 7: 실호출 게이트 — 실제 입력 × 독립 기대표

**Files:**
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneLiveGateTests.swift`
- Create: `scripts/dump-station-pois.mjs`
- 저장소 밖(커밋 안 함): `~/gildongmu-private/field-logs/station-phone-gate/inputs.json`·`dump.txt`·`expected.json`

**Interfaces:**
- Consumes: 태스크 1 `StationPhoneService.lookup`·`StationPhoneResult`.
- Produces: spec §8 실호출 게이트 결과 표(태스크 8이 spec에 적는다).

- [ ] **Step 1: 스위치로 켜는 Kit 게이트 테스트 작성**

`ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneLiveGateTests.swift`:

```swift
import Testing
import Foundation
@testable import GildongmuKit

// 역 전화번호 실호출 게이트(E44 spec §8). 기본은 꺼져 있다 — `STATION_PHONE_GATE=<expected.json>`일 때만 돈다.
// 실제 `StationPhoneService`(검색어 조립·디코딩·선택)를 프로덕션 `/api/places`에 부르고, 사람이 원본 응답을 읽어
// 적은 기대표와 대조한다(규칙으로 기대표를 만들지 않는다 — 순환 판정 금지). 입력·기대표는 저장소 밖에 둔다.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["STATION_PHONE_GATE"] != nil))
struct StationPhoneLiveGateTests {
    struct Case: Decodable {
        let name: String
        let lineName: String
        let lat: Double
        let lng: Double
        /// "direct" | "representative" | "unavailable"
        let expect: String
        let phone: String?
    }

    @Test func matchesHandWrittenExpectations() async throws {
        let env = ProcessInfo.processInfo.environment
        let path = try #require(env["STATION_PHONE_GATE"])
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let base = URL(string: env["STATION_PHONE_GATE_BASE"] ?? "https://gildongmu.dodoplanet.space")!
        let service = StationPhoneService(client: APIClient(baseURL: base))
        var mismatches: [String] = []
        for item in cases {
            let got = await service.lookup(
                stationName: item.name, lat: item.lat, lng: item.lng, lineName: item.lineName)
            let want: StationPhoneResult = switch item.expect {
            case "direct": .direct(item.phone ?? "")
            case "representative": .representative(item.phone ?? "")
            default: .unavailable
            }
            if got != want { mismatches.append("\(item.name) · \(item.lineName): got \(got), want \(want)") }
            try await Task.sleep(for: .milliseconds(250))
        }
        print("[station-phone-gate] cases=\(cases.count) mismatches=\(mismatches.count)")
        for line in mismatches { print("  x \(line)") }
        #expect(mismatches.isEmpty)
    }
}
```

Run: `cd ios/GildongmuKit && swift test --filter StationPhoneLiveGateTests 2>&1 | tail -3`
Expected: 스위트가 꺼져 건너뛴다(0 failures).

- [ ] **Step 2: 원본 POI 덤프 스크립트 작성**

`scripts/dump-station-pois.mjs`:

```js
#!/usr/bin/env node
// 역 전화번호 게이트(E44 spec §8)의 기대표 작성용 원본 덤프. 입력 역마다 /api/places 응답의 역·출구 POI를
// 사람이 읽을 수 있게 한 줄씩 찍는다(이름 | 분류 끝 조각 | 번호 | 입력 좌표에서의 거리 m). 판정 규칙을 흉내 내지 않는다.
// 사용: node scripts/dump-station-pois.mjs <inputs.json> [baseUrl] > dump.txt
import { readFileSync } from "node:fs";

const [inputsPath, base = "https://gildongmu.dodoplanet.space"] = process.argv.slice(2);
if (!inputsPath) {
  console.error("사용: node scripts/dump-station-pois.mjs <inputs.json> [baseUrl]");
  process.exit(1);
}
const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));
const meters = (a, b, c, d) => {
  const r = Math.PI / 180, R = 6371000;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
};
for (const [i, s] of inputs.entries()) {
  const query = `${s.name.replace(/\([^)]*\)/g, "").trim().replace(/역$/, "")}역`;
  const url = `${base}/api/places?query=${encodeURIComponent(query)}&lat=${s.lat}&lng=${s.lng}&lang=ko`;
  let body;
  for (let attempt = 0; attempt < 2 && !body; attempt++) {
    try {
      const res = await fetch(url);
      body = res.ok ? await res.json() : { error: res.status };
    } catch (e) {
      if (attempt === 1) body = { error: String(e) };
    }
  }
  console.log(`## ${i} ${s.name} · ${s.lineName} (${s.lat}, ${s.lng}) query=${query}`);
  if (body.error) {
    console.log(`  ERROR ${body.error}`);
  } else {
    for (const p of body.places ?? []) {
      if (!/지하철|전철|기차/.test(p.category)) continue;
      const tail = p.category.split(">").map((x) => x.trim()).pop();
      console.log(`  ${p.name} | ${tail} | ${p.phone ?? "-"} | ${meters(s.lat, s.lng, p.lat, p.lng)}m | ${p.id}`);
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}
```

- [ ] **Step 3: 입력 만들기(저장소 밖)**

```bash
mkdir -p ~/gildongmu-private/field-logs/station-phone-gate
python3 - <<'EOF'
import sqlite3, json, os, shutil, tempfile, glob
out = os.path.expanduser("~/gildongmu-private/field-logs/station-phone-gate/inputs.json")
stops = {}
for d in sorted(glob.glob(os.path.expanduser("~/gildongmu-private/field-logs/urlcache-*"))):
    tmp = tempfile.mkdtemp(); shutil.copytree(d, tmp + "/c")
    con = sqlite3.connect(tmp + "/c/Cache.db")
    rows = con.execute("select d.isDataOnFS, d.receiver_data from cfurl_cache_response r join cfurl_cache_receiver_data d on r.entry_ID=d.entry_ID where r.request_key like '%route/transit%'")
    for onfs, data in rows:
        try:
            raw = open(tmp + "/c/fsCachedData/" + (data if isinstance(data, str) else data.decode()), "rb").read() if onfs else data
            res = json.loads(raw).get("result") or {}
        except Exception:
            continue
        routes = ([res["recommended"]] if res.get("recommended") else []) + (res.get("alternatives") or []) + (res.get("routes") or [])
        for r in routes:
            for leg in r.get("legs", []):
                if leg.get("mode") == "subway":
                    for s in leg.get("stops") or []:
                        stops[(s["name"], leg["lineName"])] = {"name": s["name"], "lineName": leg["lineName"], "lat": s["lat"], "lng": s["lng"], "source": "urlcache"}
seed = json.load(open("src/lib/data/subway-stations.json"))
def seed_coord(name, line_contains):
    for x in seed:
        if x["name"] == name and line_contains in x["lineName"]:
            return x["lat"], x["lng"]
    raise SystemExit(f"seed 좌표 없음: {name} {line_contains}")
MUST = [  # (ODsay 표기 이름, ODsay 표기 노선, seed 이름, seed 노선 조각)
    ("동대문", "수도권 1호선", "동대문", "1호선"), ("동대문", "수도권 4호선", "동대문", "4호선"),
    ("동대문역사문화공원", "수도권 2호선", "동대문역사문화공원", "2호선"), ("동대문역사문화공원", "수도권 5호선", "동대문역사문화공원", "5호선"),
    ("암사역사공원", "수도권 8호선", "암사역사공원", "8호선"),
    ("부평", "수도권 1호선", "부평", "경인선"), ("부평", "인천 1호선", "부평", "인천"),
    ("신촌", "수도권 2호선", "신촌", "2호선"), ("신촌", "수도권 경의중앙선", "신촌", "경의중앙선"),
    ("김포공항", "수도권 서해선", "김포공항", "서해선"), ("김포공항", "수도권 김포골드라인", "김포공항", "김포"),
    ("서울역", "수도권 공항철도", "서울역", "공항"), ("신설동", "수도권 우이신설선", "신설동", "우이신설"),
    ("선릉", "수도권 수인.분당선", "선릉", "분당"), ("서면", "부산 1호선", "서면", "부산 도시철도 1호선"),
    ("반월당", "대구 1호선", "반월당", "대구 도시철도 1호선"), ("관악산(서울대)", "수도권 신림선", "관악산", "신림"),
    ("양평", "수도권 5호선", "양평", "5호선"), ("판교", "수도권 신분당선", "판교", "신분당"),
    ("천호(풍납토성)", "수도권 5호선", "천호", "5호선"), ("천호(풍납토성)", "수도권 8호선", "천호", "8호선"),
    ("노들", "수도권 9호선", "노들", "9호선"), ("고속터미널", "수도권 9호선(급행)", "고속터미널", "9호선"),
    ("시청·용인대", "용인에버라인", "시청·용인대", "에버라인"),
]
for name, line, sname, frag in MUST:
    lat, lng = seed_coord(sname, frag)
    stops[(name, line)] = {"name": name, "lineName": line, "lat": lat, "lng": lng, "source": "must"}
json.dump(list(stops.values()), open(out, "w"), ensure_ascii=False, indent=1)
print(len(stops), "inputs →", out)
EOF
```
Expected: 110건 안팎. `seed 좌표 없음`으로 멈추면 seed의 실제 이름·노선 표기를 `python3 -c`로 찾아 그 행의 seed 조각만 고친다(ODsay 표기 이름·노선은 바꾸지 않는다).

- [ ] **Step 4: 원본 덤프(실호출)**

```bash
node scripts/dump-station-pois.mjs ~/gildongmu-private/field-logs/station-phone-gate/inputs.json > ~/gildongmu-private/field-logs/station-phone-gate/dump.txt
grep -c "^## " ~/gildongmu-private/field-logs/station-phone-gate/dump.txt; grep -c "ERROR" ~/gildongmu-private/field-logs/station-phone-gate/dump.txt
```
Expected: `##` 수 = 입력 수, ERROR 0(있으면 그 입력만 다시 덤프). ⚠ 실호출은 프로덕션 쿼터를 쓴다 — 두 번째 전체 덤프는 하지 않는다.

- [ ] **Step 5: 기대표를 사람이 쓴다(규칙을 돌리지 않는다)**

`dump.txt`의 각 `##` 블록을 읽고 `expected.json`에 입력마다 한 항목을 쓴다: 그 역·그 노선을 가리키는 POI(이름의 역명이 같고 이름 꼬리가 그 노선이며 거리가 수백 m 안)가 번호를 갖고 있으면 `"expect": "direct"` 또는 대표번호(15xx·16xx·18xx 8자리)면 `"representative"`와 `"phone"`, 그런 POI가 없거나 번호가 없으면 `"unavailable"`. 항목 모양:

```json
{ "name": "부평", "lineName": "인천 1호선", "lat": 37.4894, "lng": 126.7249, "expect": "direct", "phone": "032-515-9103" }
```
⚠ Kit 게이트 결과를 보기 **전에** 다 쓴다. 판단이 애매한 블록(같은 노선 POI가 둘인데 번호가 다름 등)은 항목에 `"note"` 필드를 붙여 사유를 적는다(디코더는 모르는 필드를 무시한다).

- [ ] **Step 6: 게이트 실행**

```bash
cd ios/GildongmuKit && STATION_PHONE_GATE=~/gildongmu-private/field-logs/station-phone-gate/expected.json swift test --filter StationPhoneLiveGateTests 2>&1 | grep -E "station-phone-gate|  x |passed|failed" | head -40
```
Expected: `mismatches=0`. 불일치가 있으면 사례마다 원인을 가른다 — ①기대표 오기(덤프를 다시 읽어 고친다) ②규칙 결함(태스크 1 규칙·테스트를 고치고 그 사례를 `StationPhoneTests`에 fixture로 추가, 커밋) ③카카오 데이터 한계(규칙으로 풀 수 없는 경우 — spec §8 결과 표에 기록하고 위원장 보고 항목으로 남긴다). **통과선은 100% 일치**다. 한 사례 원인당 게이트 재실행은 한 번.

- [ ] **Step 7: 결과 요약 파일(저장소 밖) 작성·커밋(저장소 안 파일만)**

`~/gildongmu-private/field-logs/station-phone-gate/result.md`에 입력 수·부류별 기대(직통/대표번호/없음) 수·불일치 0 확인 시각·②③ 사례 목록을 적는다(태스크 8이 spec에 요약을 옮긴다).

```bash
git add ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneLiveGateTests.swift scripts/dump-station-pois.mjs && git commit -m "test(kit): 역 전화번호 실호출 게이트 — 실제 ODsay 경유역·필수 사례 × 사람이 쓴 기대표, 스위치로 켜는 스위트 + 원본 덤프 스크립트 (E44)

<attribution 줄>" -- ios/GildongmuKit/Tests/GildongmuKitTests/StationPhoneLiveGateTests.swift scripts/dump-station-pois.mjs
git show HEAD --stat
```

---

### Task 8: 문서 분배·빌드·실기기 배포

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md`(§8 실호출 게이트 결과 한 단락)
- Modify: `CHANGELOG.md`(2026-09-17 또는 작업일 절)
- Modify: `docs/BACKLOG.md`(§5 E44 상태, §2 판정 표에 `E44 실기기` 행, §종결된 식별자는 실기기 판정 뒤라 건드리지 않는다)
- Modify: `docs/FIELD-TEST.md`(E44 실기기 대본 행)
- Modify: `CLAUDE.md`(UI·상태 패턴에 한 줄) → 워크스페이스 루트에서 `python sync_agent_docs.py`

- [ ] **Step 1: spec §8 결과 단락**

§8 표 바로 아래에 추가(수치는 태스크 7 `result.md`에서):

```markdown
**실호출 게이트 결과(YYYY-MM-DD)**: 입력 N건(URLCache 실제 경유역 n1 · 필수 사례 n2), 기대 직통 a · 대표번호 b · 없음 c, **불일치 0**. 규칙 수정 사례: (없으면 "없음"). 데이터 한계 사례: (없으면 "없음"). 원본·기대표는 `~/gildongmu-private/field-logs/station-phone-gate/`.
```

- [ ] **Step 2: CHANGELOG**

작업일 절 맨 위에:

```markdown
### iOS 역 장소 상세 개편 — 순서·시설 접기·역 전화번호·경유역 로터 (E44)

역 상세(검색 탭 포함, `stationLayoutKind`)가 역 정보(전화 맨 위) → 실시간 도착·첫차막차 → 교통약자 시설(종류별 접기, 접힘 줄에 운행 중지 수) → 무장애 → 길찾기 → 이 장소 주변(지하철 도착 제외) 순이 됐다. 대중교통 안내 시트 경유역은 카카오 검색으로 그 노선 역 전화번호를 찾아(같은 역·같은 노선·1km, 다른 노선으로 떨어지지 않음) 상세 전화 줄과 목록 로터 "전화 걸기"로 내고, 운영사 대표번호는 "대표번호"라고 밝힌다. 조회 실패는 문장으로 가른다. 역이 아닌 장소의 상세는 그대로. spec `docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md`, 계획 `docs/superpowers/plans/2026-09-17-station-detail-reorg.md`.
```

- [ ] **Step 3: BACKLOG·FIELD-TEST**

- `docs/BACKLOG.md` §5 E44 제목의 상태를 `✅ iOS 코드 종결(YYYY-MM-DD), 실기기 판정 대기 · ⏳ 웹·안드로이드`로 바꾸고 본문에 "✅ YYYY-MM-DD 구현(커밋 범위 <첫>..<끝>)" 한 줄.
- §2 판정 표(`| **E33 실기기** |` 행 바로 아래)에 행 추가:

```markdown
| **E44 실기기** | 역 상세 개편(spec `docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md` §8 실기기 ①~⑩, 대본 `docs/FIELD-TEST.md` E44 행): ①검색 탭 역 상세 순서·전화 줄 맨 위 ②경유역 상세 전화 줄이 그 노선 역무실로 걸리는가 ③대표번호 역(수인분당선 등)이 "대표번호"로 읽히는가 ④지하에서 조회 실패 줄 ⑤시설 종류 행 펼치기·운행 중지 수 ⑥경유역 목록 로터 "전화 걸기" ⑦이 장소 주변 최하단·지하철 없음·길찾기 제목 점프 ⑧출구·비역 장소는 종전 레이아웃 ⑨영어 세션 ⑩안내 시트 "주변 확인" 결과 항목이 눌리는가. 실험판 |
```

- `docs/FIELD-TEST.md`의 실승차 대본 표(§5-2 경유역 행이 있는 표)에 같은 10축을 "언제 무엇을 듣고 무엇을 답하는가" 형식으로 한 행 추가한다(기존 행 형식을 따른다).

- [ ] **Step 4: CLAUDE.md 한 줄**

`### UI·상태 패턴` 목록의 "**검색→상세 흐름**" 항목 바로 위에:

```markdown
- **역 상세 레이아웃은 `stationLayoutKind`(Kit `StationPhone.swift`)가 켜고, 넓은 `isStation`은 역 섹션 로드에만 쓴다**(E44 — 출구 POI·"철도" 업체·이름만 "역"인 장소가 역 모양이 된다). 경유역 전화번호는 같은 역·같은 노선·1km 후보만이고 다른 노선 번호로 떨어지지 않는다. 가드 `station-detail-guard.test.ts`·노선 표 미러 `station-phone-line-table-drift.test.ts`.
```

Run: `npx vitest run src/lib/__tests__/claude-md-budget.test.ts` → PASS(80KB 상한).
Run: `cd ~/Mac-Projects && python sync_agent_docs.py` → `gildongmu/AGENTS.md` 재생성.

- [ ] **Step 5: 전체 게이트**

```bash
npm run test:run 2>&1 | tail -4
(cd ios/GildongmuKit && swift test 2>&1 | tail -3)
# 앱 컴파일 Experimental·Release (Global Constraints 명령)
```
Expected: 전부 PASS / `BUILD SUCCEEDED` 둘.

- [ ] **Step 6: 커밋(문서)**

```bash
git commit -m "docs: E44 역 상세 개편 분배 — CHANGELOG·BACKLOG 상태·§2 실기기 행·FIELD-TEST 대본·CLAUDE.md 레이아웃 판정 한 줄·spec 실호출 게이트 결과

<attribution 줄>" -- docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md CHANGELOG.md docs/BACKLOG.md docs/FIELD-TEST.md CLAUDE.md AGENTS.md
git show HEAD --stat
```

- [ ] **Step 7: 실기기 배포(정식판·실험판 둘 다)**

아이폰 연결·잠금 해제 상태에서:

```bash
CONFIGURATION=Release ./ios/deploy-device.sh 2>&1 | tail -3
CONFIGURATION=Experimental ./ios/deploy-device.sh 2>&1 | tail -3
xcrun devicectl device info apps --device 00008110-001C153022FA801E 2>&1 | grep -i gildongmu
```
Expected: 두 번 모두 설치 성공. ⚠ push·Vercel 배포는 하지 않는다(동결).

---

## 새 세션 착수 프롬프트

아래를 새 Claude Code 세션(작업 폴더 `~/Mac-Projects/gildongmu`)에 붙여 넣는다:

```
길동무 E44 역 장소 상세 개편 구현 세션이다. 첫 줄에 역할 이름 "E44 구현"을 밝혀라.
계획 docs/superpowers/plans/2026-09-17-station-detail-reorg.md 과 spec docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md 를 먼저 끝까지 읽고, superpowers:subagent-driven-development로 태스크 1부터 8까지 순서대로 진행해라.
- 2026-09-22 09:00 KST까지 push·재배포 금지(로컬 커밋만, pre-push 훅 삭제 금지). 서버 코드·웹 messages 변경 금지.
- 태스크 7의 실호출은 프로덕션 쿼터를 쓴다: 원본 덤프는 한 번만, 게이트 재실행은 불일치 원인당 한 번.
- 기대표(expected.json)는 게이트 결과를 보기 전에 사람이 덤프를 읽어 쓴다.
- 판정이 필요한 새 사안(데이터 한계로 규칙이 못 푸는 역 등)은 멈추고 비개발자 눈높이로 한 번에 한 질문씩 물어라.
- 끝나면 정식판·실험판을 실기기에 설치하고 DONE/DONE_WITH_CONCERNS로 보고해라.
```
