# 구현 플랜 — iOS 장소 상세 "이 장소 주변" (2026-08-01)

설계 정본: `docs/superpowers/specs/2026-08-01-ios-place-nearby-design.md`

## 구현 방식 판정: inline

자율성 헌장 §구현 방식 판정 기준 적용.

- **순차 의존이 강하다**: Kit `.fixed` case → 3개 모델의 anchor 파라미터 → 장소 상세 섹션 →
  i18n 키 → 카탈로그 재생성. 앞 단계가 뒤 단계의 시그니처를 정한다.
- **단일 도메인**: 전부 iOS(Kit 1파일 + 앱 4파일).
- **파일 중첩 없음이지만 규모가 작다**: 순 변경 100줄 미만 추정.

→ 위임 이득 없음. 리뷰만 별도 컨텍스트로 분리한다(헌장 §리뷰 계층 — 구현 방식과 무관).

## 태스크

### T1. Kit `NearbyCoordinateSource.fixed`
- `NearbyLoadCore.swift`: case 추가 + `load()` 좌표 해석 분기(커버리지 선분기는 `.current`와 공유).
- **게이트**: `swift test` 통과(기존 `NearbyLoadCoreTests` 전량 green — 회귀 0).

### T2. `.fixed` 계약 테스트 3케이스
- 좌표 전달(force 무관) / 커버리지 선분기 시 fetch 미호출 / 위치 실패 경로 부재.
- **게이트**: 변이 주입 — `.fixed`의 커버리지 분기를 지우면 케이스 2가 실패해야 한다.

### T3. 3개 모델·뷰의 anchor 파라미터
- `BusNearbyModel`·`BikeNearbyModel`·`ConditionsModel`: `init(anchor: NearbyCoord? = nil)`.
- 각 뷰: `init(anchor:)` + `_model = State(initialValue:)`.
  ⚠ `State(initialValue:)` 인자는 순수 생성만(부수효과 금지, [[swiftui-state-initialvalue-side-effect]]).
- **게이트**: 기존 호출처(내 주변 허브 3행) 무변경 컴파일.

### T4. 장소 상세 섹션
- `PlaceDetailView`에 `이 장소 주변` 섹션 + NavigationLink 3행, 헤더 `.isHeader`.
- **게이트**: 빌드 통과.

### T5. i18n
- `ios.place.nearbyHeading` 6로케일 추가 → `node ios/scripts/messages-to-xcstrings.mjs app`.
- **게이트**: `node ios/scripts/check-xcstrings-keys.mjs` 통과(머지 게이트).

### T6. 백로그 정리
- B1 완결 표기, B2·B3을 근거와 함께 폐기 목록으로.
- PROGRESS 운영 표 갱신.

### T7. 검증
- Kit `swift test` + `xcodebuild` 빌드.
- 시뮬레이터 실측(XcodeBuildMCP CLI): 검색 → 장소 상세 → 3행 각각 진입, 접근성 트리 스냅샷으로
  헤딩·라벨·상태 확인.
- **실기기 VoiceOver는 위원장 몫**(백로그 F에 추가).

### T8. 리뷰 → 커밋 → 푸시 → 실기기 배포
- 리뷰어에게 요구사항(스펙·플랜)과 diff만 전달(세션 히스토리 금지).
- 통과 후 commit + push + `ios/deploy-device.sh`.
