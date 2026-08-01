# 계획 — data.go.kr envelope 공용화

설계 정본: `docs/superpowers/specs/2026-08-01-datagokr-envelope-design.md`

## 구현 방식 판정 (자율성 헌장 §구현 방식 판정)

**inline.** 근거는 관측 가능한 두 축:

- **수정 파일이 겹친다.** 11개 provider가 전부 같은 신규 모듈 하나에 의존한다. 그 모듈의 시그니처가 확정되기 전엔 어느 provider도 손댈 수 없다.
- **선행 관계가 강하다.** T1(공용 모듈)이 T2~T5(호출부 교체)의 인터페이스를 통째로 정한다. 헌장이 정한 갈림 그대로 "선행 결정이 후속 태스크의 인터페이스를 바꾸는가"에 예다.

단일 도메인이고 태스크 간 독립성이 없다. 리뷰는 이 판정과 무관하게 별도 컨텍스트에 맡긴다.

## 태스크

| # | 내용 | 게이트 |
|---|---|---|
| T1 | `datagokr-envelope.ts` 신규 + 계약 테스트 | 신규 테스트 green |
| T2 | items 추출 9지점 교체(tago-bus·tago-subway·korail·seoul-metro·night-clinic·pediatric·air-quality·weather·tour-barrier-free·holiday·tour-api) | 기존 fixture 테스트 green |
| T3 | resultCode·totalCount 추출 7+4지점 교체(정책은 호출부 유지) | 〃 |
| T4 | `fetchDataGoKrJson`으로 fetch 계층 교체 — 미보유 6곳에 XML·게이트웨이 진단 확산 | `npm run test:run` 전량 |
| T5 | 변이 주입으로 계약 테스트 검출력 확인 | 변이마다 red |
| T6 | 실호출 게이트 — 계열 대표 3종(TAGO·에어코리아·기상청) | 실데이터 응답 파싱 확인 |
| T7 | 별도 컨텍스트 코드 리뷰 | Critical·Important 0 |
| T8 | 문서 갱신(BACKLOG·PROGRESS·spec §6) + commit·push | lint·build green |

## 되돌아갈 조건

T6 실호출에서 `readItems`가 어느 계열의 실응답을 놓치면 §2-1의 모양 5종이 불완전하다는 뜻이므로 스펙으로 되돌아간다(구현 계속 금지).
