# 2026-11-07 2차 병렬 웨이브 계획 (A72 · E80 · E76 후속, 다음 E79)

코디네이터 `gildongmu-75 [1ac7af]`(위원장 창, 판정 진행). 기준 SHA는 이 문서 커밋.

## §1 마일스톤·확정 판정·모델 배정

| 세션 | 과제 | 확정 판정 | 모델·노력 |
|---|---|---|---|
| `a72-android` | A72 안드로이드 게이트 복구(`:kit` E76 미러 2건·`:app` 문구 테스트 5건) | BACKLOG §1 A72 | opus · medium |
| `e80-traffic` | E80 자동차 정체 안내 1단계(게이트: 실호출 corpus·낭독 약관 → 출발 전 정체 브리핑 → 재조회 6분·10회 + 새 정체 한 문장) | BACKLOG §5 E80 판정 1·2 | opus · medium |
| `e76-followup` | E76 후속 ⓔⓕⓓ(지금 정류소 기준 노선 목록·「이미 탔어요」 뒤 번호 없는 문장·지방버스 대기 목록 노선 전부) | BACKLOG §5 E76 후속 판정 | opus · medium |
| (웨이브 2) `e79-bg-tone` | E79 대중교통 백그라운드 진행음 | BACKLOG §5 E79 + 코디네이터가 묻는 ①③ 판정 | opus · medium |

공통: 구현·이식 서브에이전트 `model: sonnet`, 리뷰어·감사 `model: opus`. 설계 리뷰: E76 후속 ⓔ는 새 외부 호출 경로(TOPIS 경유 정류소 캐시·호출량)라 codex `adversarial-review` 1회(판별 기준 "새 외부 통합 계약"). E80은 게이트 결과로 provider 응답 계약이 바뀌면 1회. A72는 생략.

## §2 파일 소유권

- `a72-android`: `android/**`만(생성 strings는 재생성만). 웹·Kit·공유 fixture는 읽기만.
- `e80-traffic`: `src/lib/providers/tmap-car.ts`·`kakao-navi.ts`·`car-route.ts`·`/api/route/car`·`src/hooks/useRouteGuide.ts`의 자동차 재조회 상수와 정체 통지, 자동차 브리핑 컴포넌트, iOS `ios/Gildongmu/Directions/BeaconModel.swift`의 자동차 갈래·자동차 브리핑 뷰, Kit 자동차 판정 새 파일, `messages/*.json`의 자동차 정체 새 키.
- `e76-followup`: `src/lib/providers/seoul-bus*`·`tago-bus*`·`transit-track.ts`·`/api/transit/track`·`/api/route/transit`의 lanes 경로, `src/hooks/useTransitGuide.ts`·`src/lib/transit-guide*.ts`, iOS `TransitGuideModel.swift`·`TransitTrackingSheet.swift`, Kit 대중교통 판정, `messages/*.json`의 `transitGuide.*` 키.
- 겹침: `messages/*.json`·생성물(xcstrings·android strings·arg-order)은 **자기 키만, 생성물은 rebase 뒤 재생성**. `BeaconTonePlayer.swift`는 E79 몫이라 웨이브 1에서는 아무도 고치지 않는다(E80이 소리를 더해야 하면 코디네이터에 보고). `TransitGuideModel.swift`가 E76 후속과 E79에 겹쳐 E79는 E76 후속 통합 뒤.
- BACKLOG·CHANGELOG·PROGRESS·FIELD-TEST: 자기 항목·자기 행만. 코디네이터도 판정 기록으로 고친다(통합 때 `comm -23` 대조).

## §3 git 격리

main 직접 push(스킬 `parallel-sessions` Claude 지침 §3). 고정 `base` rebase → `comm -23` → 생성물 재생성 → gate-lock 게이트 → `git push origin feat/<name>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only`. iOS 실기기 배포는 코디네이터 "보류 해제" 뒤 한 번에 한 세션.

## §4 웨이브

웨이브 1: `a72-android`·`e80-traffic`·`e76-followup`. 웨이브 2: `e79-bg-tone`(E76 후속 통합 뒤).

## §5 착수 프롬프트·보고

프롬프트 사본 `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`, 보고 `~/gildongmu-wt/<이름>-reports/`.
