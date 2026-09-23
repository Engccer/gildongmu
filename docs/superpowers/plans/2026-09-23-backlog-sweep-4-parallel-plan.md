# 백로그 4차 소화 — 병렬 세션 계획 (2026-09-23)

> **종료 상태(2026-09-23 저녁)**: 세션 15개 전부 main 통합·창 종료 — 웨이브 1 server-small `de526a0d`·a46 `bef6b9c2`·e44-web `ab72bf0d`·android-e44 `d90a9fec`·android-walk `a32133f0`·e42 `99564799` / 웨이브 2 e35 `9d8f6c0c`·stale-origin `1dcb120c`·android-e45 `d6fde6c5`·followup-small `935f53c7`·test-mock `04543e02` / 웨이브 3 seed-refresh `57dac3a6`·cli-release `185d371e`(npm 0.11.0)·android-e42 `88e64dcc`·e48 `ce9f644d`. 코디네이터: 적체 push `a4c86c37`, ODsay Flex 전환 `4171834c`. 실기기: 한소네 7 `88e64dcc`, iPhone 정식·실험 `88e64dcc` + 실험 `f31bb5de`. 남은 판정·후속: BACKLOG A47·A48(E49는 위원장 판정으로 열지 않음), 문서 점검은 웨이브 4 `doc-audit`.

코디네이터 세션 `gildongmu-9f [822c81]`. 동결 해제 뒤 첫 웨이브. 기준 SHA는 이 문서를 담은 커밋(착수 프롬프트에 박는다). 절차 정본은 `parallel-sessions` 스킬(Claude 분기).

## §0. 선행(코디네이터, 완료)

- 적체 374커밋 push `fde11dca..a4c86c37`(게이트 test:run 4413·tsc·lint·build 통과, tsc 오류 1건은 `android-strings-drift.test.ts` 타입 선언으로 복구). 배포본 실호출: 장소 검색·도보·대중교통·지하철 도착 200, WebMCP 도구 7개 선언. A40(웹 live region 단일화)은 이 배포로 prod 도달, 남은 것은 실사용 확인 1건(BACKLOG A40).
- 동결 정리: CLAUDE.md 동결 문장 삭제, 접근성 헌장 import를 `CLAUDE.local.md`에서 CLAUDE.md 머리로 이관, AGENTS.md 재생성.

## §1. 마일스톤·확정 판정·모델 배정

| 세션 | 항목 | 확정 판정(출처) | 모델·노력 |
|---|---|---|---|
| `server-small` | A44 · A45 · A42 · A43 | 아래 코디네이터 판정 | opus · medium |
| `a46` | A46 | 위원장 판정 3건(BACKLOG A46, 2026-09-23) | opus · medium |
| `e42` | E42 | 위원장 판정 4건(BACKLOG E42, 2026-09-13) + 문구 확정(아래) | opus · high |
| `e44-web` | E44 웹 잔여 | spec `2026-09-17-station-detail-reorg-design.md` §2 판정표 그대로 | opus · medium |
| `android-e44` | E43 우선순위 2(E44 안드로이드) | 같은 spec, iOS 정식판이 기준 | opus · medium |
| `android-walk` | E43 우선순위 4(도보 실시간 안내 정식판 이동) | 결정 확정(BACKLOG E43, 재판정 금지) | opus · medium |
| `e35` (웨이브 2) | E35 | 위원장 판정 2026-09-10(표시 전용, `realtimePosition`) | opus · high |
| `android-e45` (웨이브 2) | E43 우선순위 3(E45 안드로이드) | spec E45 그대로 | opus · medium |
| `stale-origin` (웨이브 2) | 옛 현재 위치 표기(신규) | 위원장 판정 2026-09-23(아래) | opus · medium |

**코디네이터 판정(제품 판단이 아닌 설계 사항)**:
- **A45**: 서버 `/api/chat/suggestions`의 생성 예산을 6초 → 15초로 올리고, 클라이언트(iOS Kit `ChatSuggestionsService.swift`·안드로이드 `:kit` `ChatSuggestionsService.kt`·웹 호출부) 예산은 서버보다 길게(20초) 둔다. 스트림 뒤 비동기라 사용자 대기와 무관하다. thinking 설정이 지연 원인이면 세션이 코드 대조로 판단해 조정한다. `eval:ab`(유료 호출)는 돌리지 않는다.
- **A42**: 채팅 도구 `get_subway_arrivals`가 LLM에 넘기는 `message`를 카드와 같은 우리 문장(E37 `subwayArrivalProse`, 데이터 로케일)으로 바꾸고 원문은 싣지 않는다. 못 알아본 문장은 E37 규칙대로 원문. 한 답변 안에서 표기가 하나로 모인다.
- **A43**: 스크립트만 고친다 — 접미 일치(`endswith("환승역")`) + 알려진 어휘 4종 밖의 값이 나오면 중단하는 가드 + 테스트. **seed 재생성은 하지 않는다**(신분당선 좌표 이동·대전 `stationId` 형식 변화가 미판정이라 BACKLOG에 남긴다).
- **E33 웹 잔여·B6·B8·B9 ②**: 이번 웨이브 밖. 웹 실시간 안내가 실보행 미검증이라는 기존 보류 사유가 그대로다.

**E42 문구(위원장 TextEdit 확정, 2026-09-23)** — 렌더된 줄 기준, 이 문장 그대로:
- 첫째 줄(기본 펼침): `최단 경로, 총 850m, 약 12분`
- 둘째 줄(접힘): `계단 회피 경로, 총 880m, 약 13분`
- 계단 회피 경로가 없을 때 둘째 줄: `큰길 경로, 총 880m, 약 13분` — **사유 문장을 붙이지 않는다**(위원장이 초안의 "계단을 피하는 길이 없습니다"를 지웠다. 되살리지 말 것. 이름이 곧 정보다)
- 줄 안의 안내 시작 버튼: `최단 경로로 안내 시작` · `계단 회피 경로로 안내 시작` · `큰길 경로로 안내 시작`
- 비-ko 문구는 ko 뜻을 따른다. en 화면 구성(현행 Tmap 2행 유지가 강한 디폴트)은 세션 설계 몫.

**stale-origin 판정(위원장 2026-09-23)**: 현재 위치 재측위가 실패하고 직전 좌표가 있으면 옛 주소를 계속 쓰되 **옛 위치임과 시각을 밝힌다**(예: "마지막으로 확인한 위치, ○○로 12, 5분 전"). 길찾기는 그 위치로 계속할 수 있다. 웹·iOS·안드로이드 동조. 렌더 문구는 세션이 시안을 보고 파일에 쓰고 코디네이터가 위원장과 TextEdit으로 확정한다.

## §2. 파일 소유권 지도

| 세션 | 소유 | 경계 인터페이스·주의 |
|---|---|---|
| `server-small` | `src/app/api/chat/route.ts`·`src/app/api/chat/suggestions/**`·`src/lib/chat/router.ts`(`get_subway_arrivals` 자리)·Kit `ChatSuggestionsService.swift`·`:kit` `ChatSuggestionsService.kt`와 각 테스트·`scripts/build-subway-stations.py`(+테스트) | NDJSON 계약: U+2028·U+2029·U+0085를 `\u` 이스케이프로 치환(JSON 유효). 클라이언트 변경 없음 |
| `a46` | iOS `TransitGuideModel.swift`·`TransitGuideTextRenderer.swift`·Kit `TransitGuideText.swift`·웹 `transit-guide-text.ts`·`TransitGuidePanel.tsx`·`:kit` `TransitGuideText.kt`·공유 fixture `transit-guide-text-cases.json`·`transit-background-guards.test.ts`·대중교통 안내 i18n 키 | `vehiclePassed` 문장 변경은 fixture를 공유하는 세 미러(웹·Kit·`:kit`)를 한 커밋에 |
| `e42` | `src/lib/walk-route.ts`·`src/lib/providers/kakao-walk.ts`·`src/app/api/route/walk/**`·웹 `DirectionsView.tsx`의 도보 행·`useRouteGuide` 도보 variant·iOS 길찾기 도보 행·도보 i18n 키·WebMCP `plan_directions`/`get_route_steps`의 도보 variant 투영(`src/lib/webmcp/**` 해당 자리)·CLI 카탈로그 해당 자리 | **서버 응답 모양 변경은 iOS `routeKey`처럼 필수 디코딩 여부를 먼저 본다 — 웹 배포가 앱보다 먼저.** `annotateCrosswalkInfo` 두 줄 적용은 실호출로 확인 |
| `e44-web` | `src/components/PlaceDetail.tsx`의 역 분기·웹 역 섹션 컴포넌트·웹 역 전화 조인(Kit `StationPhone.swift`의 웹 미러)·역 상세 i18n 키 | `station-phone-line-table-drift.test.ts`가 이미 표를 잠근다 — 웹 미러를 그 가드에 편입 |
| `android-e44` | `android/app/.../place/**`·`:kit` `StationPhone.kt`(신규 이식)+테스트·`android/kit/mirrors/*.json`의 StationPhone 행 | 등록부 3벌 잠금(`mirror-registry.test.ts`) |
| `android-walk` | `android/app/.../guide/**`·`AppConfig` 도보 게이트·정식 소스셋 매니페스트·`android/scripts/check-release-manifest.mjs`·관련 테스트 | iOS 졸업 선례(CLAUDE.md §iOS 실험 기능 — 코드 게이트·백그라운드 권한 함께 승격) |

**겹침과 직렬**: `stale-origin`은 `e42`(웹 `DirectionsView.tsx`·iOS 길찾기 뷰)와 겹쳐 웨이브 2. `e35`는 `a46`(`TransitGuideModel.swift`)과 겹쳐 웨이브 2. `android-e45`는 `android-e44`의 역 상세·전화에 연결하므로 웨이브 2.

**공용 생성물 규약**: `messages/*.json`은 자기 키만 추가·수정한다. 생성물(iOS xcstrings·`ios/i18n/arg-order.json`·안드로이드 `strings.xml`·릴리스 노트 JSON)은 **rebase 뒤 재생성**하고 손으로 병합하지 않는다. `CHANGELOG.md`·`docs/BACKLOG.md`·`PROGRESS.md`는 자기 항목만, rebase 뒤 `comm -23` 소실 대조.

## §3. git 격리 — 저장소 정책: main 직접 push

`prepare-worktrees.sh`가 만든 `~/gildongmu-wt/<이름>`(브랜치 `feat/<이름>`)에서 작업한다. 통합:

```bash
git fetch origin && base=$(git rev-parse origin/main) && git rebase "${base}"
comm -23 <(git show "${base}:docs/BACKLOG.md" | sort) <(sort docs/BACKLOG.md)   # 고친 공유 문서마다, 중괄호 필수
# 생성물 재생성 → 게이트(gate-lock.py) → push
git push origin feat/<이름>:main && git -C ~/Mac-Projects/gildongmu pull --ff-only
```

main push는 Vercel 프로덕션 자동 배포다(이 repo는 리뷰 게이트 통과 후 자동 push 허용). `--force` 금지. `git add -A` 금지.

## §4. 웨이브

- **웨이브 1**: `server-small` · `a46` · `e42` · `e44-web` · `android-e44` · `android-walk`
- **웨이브 2**: `e35`(a46 통합 뒤) · `stale-origin`(e42 통합 뒤) · `android-e45`(android-e44 통합 뒤)
- **웨이브 3**: `doc-audit`
- **실기기 배포**: 세션은 하지 않는다. iOS 두 구성·한소네 설치는 통합 뒤 코디네이터가 한 번에 한 대상씩 배정한다.

## §5. 착수 프롬프트·보고 경로

프롬프트 사본: `~/.claude/parallel-sessions/gildongmu/<이름>.prompt.txt`. 보고: `~/gildongmu-wt/<이름>-reports/`.
