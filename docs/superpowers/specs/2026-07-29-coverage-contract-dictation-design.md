# 서비스 지역 계약 + 받아쓰기 재설계 (App Review 2.1(a) 대응)

- 날짜: 2026-07-29
- 배경: iOS 1.0 (4) App Store 심사 반려. Guideline 2.1(a) Performance: App Completeness. 심사 환경(iPhone 17 Pro Max, iOS 26.5.2, 미국 좌표)에서 ① 날씨·공기질 카드 "Couldn't load", ② Where am I "Failed to get current location", ③ 음성 받아쓰기 무반응이 보고됨(Submission ID 28eca73c-f832-463c-8831-a26c439a23d1, 증거 스크린샷 2장 확보).
- 원인: 좌표 라우트 11곳의 인라인 한국 bbox zod가 미국 좌표를 400으로 차단하고, iOS가 이를 일반 오류("불러오지 못함"·"위치 조회 실패")로 렌더. 받아쓰기는 홀드 기본값에서 짧은 탭이 무반응(안내가 VO 통지뿐)이고, en-US 전사 모델 미설치 시 다운로드가 진행 표시 없이 돌다 무음 종료.

## 설계 원칙

1. **제약의 근원은 API 데이터 커버리지다.** upstream(카카오·네이버·기상청·에어코리아·공공데이터·길찾기 3사)이 대한민국 데이터만 보유한다. 서버 bbox는 그 현실을 앞당긴 방어막일 뿐이므로, "서비스 지역 밖"은 오류가 아니라 **정직한 4번째 상태**로 표현한다(walk-infra `unsupported` 원칙의 확장. 3-state 불변식과 정합).
2. **좌표 기반 기능만 지역 제한이고, 이름 기반 기능은 전 세계에서 유효하다.** 장소·주소 텍스트 검색, 역 시설·시간표(역명 기반), 목적지 지정 길찾기 브리핑, 장소 앵커 채팅, 웹검색은 해외에서도 동작한다(방한 예정 외국인의 출국 전 계획 시나리오). 안내 문구와 게이트 기준이 이를 뭉개면 안 된다.
3. 정상 응답은 byte-불변으로 유지한다. 구 클라이언트(현행 배포본·구 CLI)는 마커 디코딩 실패 → 현행 400과 동일한 오류 표시로 수렴(회귀 없음).

## 1. 커버리지 정본 술어

- `src/lib/coverage.ts` 신설(React/Next 비의존): `KOREA_COVERAGE_BBOX` + `isInKorea(lat, lng)`.
- 값은 기존 `deeplink.ts`의 넓은 범위를 정본으로 승격: 위도 31.43~44.35, 경도 122.37~132.0 (네이버 지도 scheme 유효 범위 기원).
- `deeplink.ts`·`route-coord-schema.ts`가 coverage.ts를 import(자체 정의 제거). 라우트 인라인 bbox(33~43/124~132) 전부 제거.
- iOS: GildongmuKit `Coverage.swift` 신설, `Deeplink.swift`의 `isInKorea`를 이관하고 Deeplink는 재사용. 값 동조(웹 미러 주석).
- 서울 bbox(`audio-signals.ts` `SEOUL_BBOX`)는 별개 층으로 유지.

## 2. 서버 계약: 200 + `outOfCoverage` 마커

- 좌표 zod는 전지구 정합성만 검증(lat -90~90, lng -180~180). 범위 밖·비수치는 종전대로 400.
- 좌표가 유효하나 `isInKorea` false → **200 `{ "outOfCoverage": true }`** 즉시 반환(upstream 미호출, 쿼터 보호 유지).
- 적용 라우트(13): `weather/nearby` · `air-quality/nearby` · `where-am-i` · `bus/nearby` · `bike/nearby` · `clinic/nearby` · `places/around` · `places/kids` · `places/barrier-free` · `station/subway-arrival/nearby` · `route/car` · `route/transit` · `route/walk`(길찾기는 출발·도착 어느 한쪽이라도 밖이면 마커).
- 공용 헬퍼: 라우트에서 반복될 판정·응답을 `src/lib/coverage.ts`(판정)와 라우트 공용 유틸(예: `outOfCoverageResponse()`)로 묶어 13곳 복붙 금지.
- **제외**: `walk/nearby`(자체 discriminated union으로 이미 전지구 대응, OSM은 해외 실동작) · `places`(텍스트 검색은 전지구 유효) · `geocode/reverse`(address:null graceful 현행 유지, 클라 선분기가 호출 자체를 생략) · `places/barrier-free/match`(매칭 보조, `{detail:null}` 유지).

## 3. 웹 소비

- 위치 의존 컴포넌트(내 주변 전 종목·LocalConditions·WhereAmI·DirectionsView의 현위치 출발)는 **fetch 전 `isInKorea` 선분기** → 커버리지 안내 렌더, 서버 호출 생략.
- 서버 마커 수신 시에도 같은 안내(URL 직접 진입 등 이중 방어).
- 안내 문구 i18n 키 `common.outOfCoverage`(6개 로케일): ko "현재 위치 기반 기능은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기는 계속 사용할 수 있습니다." / en "Location-based features are available within South Korea. Place search, station info, and directions remain available." (앱 전체 불가처럼 읽히는 문구 금지)
- 통지는 기존 단일 polite live region 재사용. 상태는 오류(error)와 별개 분기(스타일도 오류 색 미사용).
- 검색은 한국 밖 좌표를 블렌딩 파라미터로 보내지 않는다(9,000km 거리 주석 방지). 현재 위치 주소 라벨(`geocode/reverse`)도 선분기로 호출 생략.

## 4. iOS 소비

- `NearbyLoadState`(`ios/Gildongmu/Nearby/NearbyLoadState.swift`)에 `.outOfCoverage` 케이스 추가.
- `APIClient`에 마커 감지 1곳 추가: 2xx 응답이 `{outOfCoverage:true}`면 `APIError.outOfCoverage` throw. 각 뷰(9종 nearby·Conditions·WhereAmI·Directions)는 이 오류를 `.outOfCoverage` 상태로 매핑해 안내 렌더(`ContentUnavailableView`, xcstrings 키 `ios.common.outOfCoverage` 1개 공유, 웹 문구와 동일).
- 뷰 선분기: 위치 취득 직후 Kit `isInKorea`로 확인해 한국 밖이면 네트워크 호출 생략(이중 방어).
- **WhereAmI 오해 문구 분리**: 서버 실패는 "정보를 불러오지 못했습니다" 계열로, `ios.nearby.whereAmIFailed`("현재 위치 조회 실패")는 진짜 위치 취득 실패(`LocationError`)에만 사용. `ConditionsView`의 `try?` 삼킴은 do-catch로 전환해 `.outOfCoverage`와 일반 실패를 구분.

## 5. 채팅 게이트 (앵커 좌표 기준)

- `src/lib/chat/router.ts`: 좌표 의존 도구 실행 전, **그 도구가 실제 쓰는 앵커 좌표**(`placeContext` 있으면 `anchorOf(ctx)`, 없으면 `userLocation`)를 `isInKorea`로 판정. 밖이면 provider 미호출, 결정론 데이터 `{ outOfCoverage: true }` 반환 → Gemini가 산문으로 정직 설명(render 카드 없음, source 미포함).
- **placeContext(한국 장소) 앵커면 사용자 위치가 해외여도 정상 동작해야 한다** — userLocation 기준 일괄 차단 금지.
- 길찾기 도구는 출발지가 실제 `userLocation`이므로 출발지 밖이면 마커(장소 앵커로 덮지 않는 기존 불변식 유지).

## 6. CLI / MCP

- `packages/cli`·`packages/mcp`: 마커 응답 수신 시 표준 안내 문구 출력("서비스 지역(대한민국) 밖 좌표입니다. 장소 검색·역 정보·길찾기는 사용 가능합니다." 계열). 카탈로그(`endpoint-catalog-shared.ts`) 両미러 동조, drift 테스트 통과.
- 버전 릴리스(cli-v 태그)는 재제출과 독립적으로 진행 가능(웹·iOS가 우선).

## 7. iOS 받아쓰기 전면 수정

1. **기본값 전환: 홀드 → 탭 토글**(위원장 결정 2026-07-29, 직관성). `DictationStyle` 미저장 사용자의 기본을 `.tapToggle`로, 설정(`SettingsView`) 옵션 순서도 탭 토글을 위로. 홀드는 선택 옵션으로 유지하며 홀드 계약(릴리스 확정·잠금=일시정지·왼쪽 취소·VO 무발화)은 불변. 탭 토글 라벨 전환("받아쓰기 시작"↔"중지")이 가시 상태 신호가 되어 짧은 탭 무반응 문제가 기본 경로에서 구조적으로 소멸.
2. **홀드 모드 짧은 탭 가시 안내**: 홀드 선택 사용자에 한해, 짧은 탭 시 비-VO 사용자에게도 보이는 일시 안내("길게 누르고 말하기") 표시. 기존 VO polite 안내는 불변.
3. **전사 모델 preflight**: 세션 시작 전 `SpeechTranscriber.installedLocales`로 설치 여부 선판정. 미설치면 "음성 인식 준비 중(다운로드)" 가시 상태로 `AssetInventory.assetInstallationRequest → downloadAndInstall()` 진행(최소 불확정 진행 표시). 준비 중 마이크는 포커스 유지 원칙대로 비활성 스타일+가드(disabled 금지). 완료 후 사용 가능.
4. **`AssetInventory.reserve(locale:)` 예약** 추가(시스템 회수 방지). 앱 언어 변경 시 예약 갱신.
5. **오류 종별 표면화**: `SpeechService.start()`의 catch가 오류를 버리지 않는다. `SpeechError` 케이스 확장(로케일 미지원/오디오 사용 불가/모델 다운로드 실패/일반), os_log 기록, 종별 알럿 문구(xcstrings). 스트림 실패 빈 catch(`SpeechService.swift:174-176`)도 로그+실패 전이.
6. **`NSSpeechRecognitionUsageDescription` 방어적 추가**(INFOPLIST_KEY + InfoPlist.xcstrings 로컬라이즈).
7. **Siri 단축어 다국어 문구**: `AppShortcuts.swift` phrases가 한국어 하드코딩 — 영어(및 지원 로케일) 문구 추가. 외부 시작 세션 계약(탭=정지·검색)은 불변.
8. 오디오 세션·컨버터 실패는 5의 종별 표면화로 커버(자동 재시도 미도입, YAGNI).
9. **판정 기록**: `AppLanguage.current`의 ko 최종 폴백은 현행 유지 — `Bundle.main.preferredLocalizations`가 번들 로컬라이즈 목록 안에서 협상하므로 영어 기기는 en으로 정상 수렴. TTS(`TtsPlayer`)는 전 실패 경로에 폴백 체인이 있어 무변경.

## 8. 검증 (머지 게이트)

- **게이트 테스트**: coverage 술어 단위 · 13개 라우트 마커(미국 좌표 → 200 마커, 한국 좌표 → 기존 응답 byte-불변, 전지구 밖 → 400) · 채팅 라우터 게이트(앵커 우선 판정 포함) · CLI 포매터 · i18n 키 테스트.
- **심사 환경 등가 실검증**: 시뮬레이터 위치를 샌프란시스코로 고정(xcodebuildmcp/simctl)하고 영어 로케일로 심사 동선 재현 — Nearby 전 종목·Conditions·WhereAmI(커버리지 안내 확인), 받아쓰기(탭 토글, 모델 미설치 시나리오), 검색 "Gyeongbokgung"(정상 동작 확인), 장소 앵커 채팅(주변 도구 정상 동작 확인). 웹은 dev에서 미국 좌표 mock으로 동일 재현.
- **프로덕션 실호출**: 배포 후 미국 좌표 curl로 마커 응답 확인.
- a11y: 변경 화면 `a11y-auditor` 점검(커버리지 안내는 오류 아님 톤, 단일 polite 채널 유지).

## 9. 재제출 · 심사 회신

- 빌드 번호 올려(1.0 (5)) 업로드 → ASC Resubmit.
- 심사 회신(영문): 한국 지역 서비스 설명 + 수정 요지(지역 밖 안내 상태, 받아쓰기 탭 토글 기본·준비 상태 가시화) + 해외에서도 동작하는 핵심 기능 안내. **발송은 외부 발신 하드 스톱 — 초안 작성 후 위원장 승인을 받아 발송한다.**

## 마일스톤 순서

① 술어+서버 계약(+테스트) → ② 웹 소비 → ③ iOS 소비 → ④ 채팅·CLI/MCP → ⑤ iOS 받아쓰기 → ⑥ 실검증·재제출·회신.

## 후속 (이번 범위 밖)

- dodo-planet 이식 시 coverage 패턴·받아쓰기 기본값 동조.
- 접근성 헌장 §6 받아쓰기 기본 계약 서술 갱신(구현 확정 후).
