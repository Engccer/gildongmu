# 플랜 — 근처 문화행사 (2026-08-01)

설계: `docs/superpowers/specs/2026-08-01-nearby-culture-events-design.md`

## 구현 방식 판정 — 혼합 (근거 기록)

자율성 헌장 §구현 방식 판정. 축은 규모가 아니라 **태스크 결합도**다.

- **선행 결정이 후속 인터페이스를 바꾼다**: `CultureEvent` 투영 타입과 `/api/events/nearby` 응답 스키마가 확정되기 전에는 웹 컴포넌트·iOS 뷰·채팅 도구·CLI 카탈로그의 계약이 정해지지 않는다. → **T1~T3은 inline**.
- **인터페이스 고정 후 T4~T7은 서로 독립**: 수정 파일이 겹치지 않고(웹 컴포넌트 / Swift / 채팅 / 카탈로그) 선행 관계도 없다. → 위임 가능 구간.
- 실제 배선(`NearbyHub`·`declarations`·카탈로그 미러)은 짧은 편집이라 inline이 싸다. **리뷰만은 판정과 무관하게 별도 컨텍스트**(헌장 §리뷰 계층).

**되돌아갈 조건**: 실호출이 §1 전제(진행 중 244건·좌표 100%·`INFO-000` 단일 정상코드)를 무효화하면 구현을 멈추고 스펙으로 돌아간다.

## 태스크

| # | 내용 | 게이트 |
|---|---|---|
| T1 | provider `seoul-culture-events.ts` — 20페이지 수집·`INFO-000` 정책·진행 판정·슬림 투영·`unstable_cache`(일자 키) | 단위 테스트: 봉투 4케이스 + 진행 경계 3케이스 + cultcode 폴백 |
| T2 | service `culture-events.ts` — Haversine·3km·거리순·캡 50·`total` | 단위 테스트: 정렬·필터·절단 전 total |
| T3 | route `/api/events/nearby` — zod·커버리지 마커 선행·키 게이트·`limit`·502 | 라우트 테스트 5케이스 |
| T4 | 웹 `CultureEventsNearby.tsx` + `NearbyHub` 배선 + i18n 6로케일 | jsdom 컴포넌트 테스트 + nearby 계약 스위트 |
| T5 | 채팅 도구 `get_nearby_events` + declaration 게이트 + 앵커 | 도구 테스트(게이트 0노출 포함) |
| T6 | CLI/MCP 카탈로그 両미러 | drift 테스트 |
| T7 | iOS `EventsNearbyView` + Kit `NearbyService` + 허브 행 + xcstrings | Kit 테스트 + 키 린터 + 빌드 |
| T8 | 변이 주입 검출력 실측 · 실호출 게이트 4종 · 별도 컨텍스트 리뷰 · 문서(PROGRESS·CLAUDE·백로그) | 전량 green |

## 완료 정의

Vitest 전량 green · lint 0 errors · build green · Kit 테스트 green · 실호출 4종 통과 · 리뷰 Critical 0 · commit+push.
