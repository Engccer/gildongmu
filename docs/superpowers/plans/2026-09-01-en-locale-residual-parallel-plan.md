# 영어 잔여 정리 — 병렬 세션 계획 (2026-09-01)

> 코디네이터 세션이 작성. 어제(2026-08-31) A26·E27·E28·A27·A28·A29 세 웨이브로 세운 영어 기계에 **문이 안 열린 자리**가 남았다. 그 셋을 병렬 세션으로 닫는다.
>
> **착수 기준 SHA**: 이 문서 커밋 시점의 `main`.

## 0. 배경 — 왜 새 언어가 아니라 영어 잔여인가

2026-09-01 판정 세션에서 "다른 언어 추가 규모"를 실측했다. 결론: 어제 한 14,000줄 중 대부분은 언어 무관 골격(A26 부품화·A29 복수형 해석기·E27/E28 파이프라인)이라 다음 언어는 언어당 1,500~2,000줄로 떨어진다. **그러나 검증 비용이 반대로 오른다** — 도보 안내 실사용 판정은 그 언어를 쓰는 스크린 리더 사용자여야 의미가 있다(`docs/BACKLOG.md` E16 축3).

그래서 위원장 판정: **새 언어를 넣기 전에 영어에서 "이 방식이 실제로 통하는가"를 닫는다.** 영어에서 안 통하는 방식이면 다른 언어에서도 안 통한다.

## 1. 마일스톤과 확정 판정

### 확정 판정 (2026-09-01 위원장, AskUserQuestion 순차 3문)

| # | 질문 | 판정 |
|---|---|---|
| 1 | 착수 범위 | **영어 잔여부터 닫는다**(새 언어 추가는 그 뒤) |
| 2 | 실시간 대중교통 안내 en 게이트 범위 | **웹 정식판 + iOS 실험판 둘 다** — 문장 영문화가 어차피 공통이라 같은 자리를 두 번 열지 않는다 |
| 3 | CLI/MCP `lang` | **배선을 마저 한다**(문서 한정 봉인 기각) — 서버는 이미 다 받고 있고, MCP는 에이전트 창구라 영어권 에이전트가 한국어 문장을 받는 상태가 남는다 |

### 코디네이터가 강한 디폴트로 정한 것 (묻지 않음)

- **소품 5건을 한 세션(C)으로 묶는다.** 전부 독립이고 소유 파일이 A·B와 안 겹친다.
- **`/api/geocode/reverse`의 `lang`을 `langParam()`으로 통일한다**(미지 값 400). 소비자가 우리 코드뿐이라 파급이 국소적이고, 조용히 ko로 떨구는 현행은 E27이 세운 원칙과 정면으로 반대다.
- **npm 발행은 이 계획 밖이다**(§6).

### 마일스톤 3개

| 세션 | 마일스톤 | 요지 | spec 필요 |
|---|---|---|---|
| **A. transit-en-gate** | E27 잔여 ① 실시간 대중교통 안내 en 게이트 해제 | 게이트 해제 + 안내 상태 머신 display DTO(`viaStops[].name`·실시간 정류소명·차량 선택 문맥) | **필요** — spec §3.7이 통째로 미룬 설계 |
| **B. cli-lang** | E26 + E27 잔여 ② CLI/MCP `lang` | `route walk`·`route transit`·`station` 계열에 `lang` 배선 + 카탈로그·포매터·drift 테스트 | 불필요(plan만) |
| **C. en-polish** | E27 잔여 ③~⑤ + A30 소품 | 노선명 표 미적용 2곳 · A30 가운뎃점 · geocode/reverse `langParam` · 수동 위치 라벨 병기 · GTX-A 실호출 | 불필요 |

## 2. 파일 소유권 지도

### A. transit-en-gate (단독 소유)

```
src/components/TransitGuidePanel.tsx
src/hooks/useTransitGuide.ts
src/lib/transit-guide.ts
src/components/DirectionsView.tsx                       ← 게이트 3줄만 (아래 ⚠)
src/lib/__tests__/fixtures/transit-guide-*.json
ios/Gildongmu/Directions/TransitGuideModel.swift
ios/Gildongmu/Directions/TransitTrackingSheet.swift
ios/Gildongmu/Directions/TransitGuideDiag.swift
ios/Gildongmu/Directions/DirectionsTabView.swift        ← 대중교통 게이트만 (아래 ⚠)
ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift
ios/GildongmuKit/Tests/GildongmuKitTests/TransitGuideTests.swift
docs/superpowers/specs/2026-09-01-transit-guide-en-gate-design.md   (신규)
messages/*.json                                          ← `transitGuide.*` 네임스페이스만
```

⚠ **`DirectionsView.tsx:406`의 `stepFreeSupported = !prefersEnglish(locale)`는 건드리지 않는다.** 계단 회피는 별개 축이고 **의도적으로 비-ko에 노출하지 않는다**(Tmap에 검증된 회피 축이 없어 항상 `unavailable`인데 켤 수 있게 두면 SR 사용자는 적용됐다고 믿는다 — CLAUDE.md §도보 경로). 같은 파일 `carGuideStartable`(934행)의 `!prefersEnglish`도 **자동차 축이라 대상 밖**이다. 여는 것은 대중교통 두 자리(1033·1621행)뿐.

⚠ iOS `DirectionsTabView.swift`도 같다 — `dataLocale == "ko"` 검사가 10곳인데 walk(793)·car(1076)·계단 회피(393·460)는 **전부 대상 밖**이다. 대중교통 안내 시작 자리만.

### B. cli-lang (단독 소유, 완전 격리)

```
packages/cli/**
packages/mcp/**
```

`endpoint-catalog-shared.ts`는 cli·mcp 両미러이고 drift 테스트가 byte 해시로 강제한다 — **양쪽을 같은 커밋에서 동일하게 고친다.**

### C. en-polish (단독 소유)

```
src/lib/place-lines/station-metro.ts
src/components/SeoulMetroFacilities.tsx
src/app/api/geocode/reverse/route.ts
src/lib/manual-location-store.ts
src/components/LocationBar.tsx
ios/GildongmuKit/Sources/GildongmuKit/ManualLocation.swift
scripts/verify-odsay-lang.mjs                            ← 실행·결과 기록만
messages/*.json                                          ← `bike.*`·`manualLocation.*`·`subway.*` 네임스페이스만
```

`src/lib/subway-line-names.ts`는 **읽기 전용**(C가 이 표를 타게 만들 뿐 표 자체는 안 고친다).

### 공유 자산 규약

| 파일 | 규약 |
|---|---|
| `messages/*.json` (6로케일) | **자기 네임스페이스 키만.** A=`transitGuide.*`, C=`bike.*`·`manualLocation.*`·`subway.*`. B는 안 건드린다 |
| `ios/Gildongmu/Resources/Localizable.xcstrings` | **생성물** — rebase 뒤 `node ios/scripts/messages-to-xcstrings.mjs` 재생성. 손으로 병합하지 않는다 |
| `CHANGELOG.md` · `docs/BACKLOG.md` | 자기 항목만. rebase 뒤 `comm -23 <(git show origin/main:CHANGELOG.md \| sort) <(sort CHANGELOG.md)`로 소실 줄 전수 대조 |
| `CLAUDE.md` | 자기 마일스톤이 만든 **새 함정만** 추가. 기존 절 재서술 금지 |
| `PROGRESS.md` | 상태 한 줄만 |

## 3. git 격리 절차 (세 세션 공통)

```bash
git worktree add ~/gildongmu-wt/<name> -b feat/<name> main
cp ~/Mac-Projects/gildongmu/.env.local ~/gildongmu-wt/<name>/.env.local
cd ~/gildongmu-wt/<name> && npm ci        # 심링크 금지 — 실제 설치
```

- 커밋은 **pathspec**으로: `git commit -- <경로들>`. `git add -A`·`git add .` 금지.
- 커밋 직후 `git show HEAD --stat`으로 의도 파일만 들었는지 검증.
- 통합: `git fetch && git rebase origin/main` → 생성물 재생성 → `npm run test:run` + `npm run build` → `git push origin feat/<name>:main`(ff만). `--force` 금지.
- ⚠ **`packages/cli`·`packages/mcp` 테스트는 루트 `npm run test:run`이 안 돈다**(include가 `src/**`·`scripts/**/*.test.mjs`뿐). B 세션은 각 디렉터리에서 `npx vitest run`을 별도로 돌린다 — 루트에서 이름을 넘기면 "No test files found"가 **통과가 아니라 무실행**이다.
- 끝나면 `git worktree remove ~/gildongmu-wt/<name>`.

## 4. 웨이브

**웨이브 1에 A·B·C 동시.** 소유 파일이 겹치지 않고 셋 다 자기 안에서 완결된다.

- **배포 락**: 실기기 배포는 A만 필요하다(iOS 실험판). B·C는 웹 push 또는 코드 통합까지. 그래도 A가 배포 직전 코디네이터에 알린다.
- **위원장 시간 우선순위**: W2(WebMCP 2차) 실기기 판정이 **2026-09-04 05:00 KST 마감**이라 위원장 시간은 그쪽이 먼저다. A의 실승차 판정은 마감 뒤로 미룬다(코드 통합은 그와 무관하게 진행).

## 5. 세션별 착수 프롬프트

### A. transit-en-gate

```
[병렬 세션 배정: 이 세션의 역할 이름은 **transit-en-gate** 다. 첫 응답 첫 줄에 "세션 transit-en-gate" 라고 밝혀라.]

계획 문서 `docs/superpowers/plans/2026-09-01-en-locale-residual-parallel-plan.md`를 먼저 읽어라. §2의 소유 파일 밖은 만지지 않는다.

과제: 실시간 대중교통 안내의 en 게이트를 웹 정식판 + iOS 실험판 양쪽에서 연다(위원장 판정 2026-09-01).

배경 정본: `docs/superpowers/specs/2026-08-31-transit-english-design.md` §3.7이 이 작업을 통째로 미뤄 뒀다. 그 절이 요구하는 것:
- 게이트를 여는 날 `viaStops[].name`·실시간 provider 정류소명·차량 선택 문맥까지 **별도 display DTO**가 필요하다(지금 `TransitGuideLeg` 표시 라벨은 도달 사용자가 없는 죽은 배선이다).
- 불변식: 상태 머신 테스트가 조인 필드에 식별 가능한 한국어 sentinel을 넣고 **어떤 발화에도 그 값이 나오지 않는다**.

인계(E27이 어제 만든 것, 그대로 쓴다):
- 서버 `*En` additive 필드와 `lang` 파라미터는 이미 있다(`src/lib/lang-param.ts` `langParam()`, 미지 값 400).
- 줄 조립은 웹 `src/lib/place-lines/pick-line.ts`의 `pickLine` ↔ Kit `TransitDisplay.pickLine` 한 자리만 지난다. 조각 3-state: `undefined`=결측(→한국어 폴백 + `lang="ko"`), `""`=자리 표시(ko에도 없는 조각), 문자열=영문.
- 노선명 표 `src/lib/subway-line-names.ts`, 도착 영어 문장 `src/lib/subway-arrival-en.ts`, 정류소명 정규화 `src/lib/transit-name-en.ts`.
- A27 `subwayRidingMessage(arrivalCode)`는 **언어 무관 문장 종류 판정**이라 이 축이 아니다. 건드리지 마라.

⚠ 절대 건드리지 않는 것:
- `DirectionsView.tsx:406` `stepFreeSupported = !prefersEnglish(locale)` — 계단 회피는 의도적으로 비-ko 미노출이다(Tmap에 검증된 회피 축 없음).
- `DirectionsView.tsx:934` `carGuideStartable`의 `!prefersEnglish` — 자동차 축.
- iOS `DirectionsTabView.swift`의 walk(793)·car(1076)·계단 회피(393·460) `dataLocale == "ko"` 검사.
여는 것은 대중교통 안내 시작 자리뿐이다(웹 1033·1621, iOS 대응 자리).

절차:
1. spec `docs/superpowers/specs/2026-09-01-transit-guide-en-gate-design.md` 작성. **display DTO는 새 판정 계층이므로 착수 전 codex `adversarial-review`를 돌리고 판정 한 줄을 spec 머리에 남긴다**(글로벌 규칙 ①).
2. writing-plans → 구현 → spec-compliance·code-quality·a11y-auditor 리뷰.
3. 게이트 테스트(`npm run test:run`) + `npm run build` + Kit 테스트.
4. 문서 분배(CHANGELOG·BACKLOG E27 잔여 종결·CLAUDE.md 함정·PROGRESS 한 줄). §2 공유 자산 규약을 지켜라.
5. 통합: rebase → xcstrings 재생성 → 게이트 → ff push.
6. iOS 실험판 배포는 **코디네이터에 먼저 알리고** 허가 뒤에 `CONFIGURATION=Experimental ./ios/deploy-device.sh`.

실승차 판정은 이 세션 몫이 아니다 — 위원장 시간은 W2 마감(2026-09-04 05:00)이 먼저다. FIELD-TEST에 대본만 남겨라.

통합·배포 시작·완료마다 코디네이터에 SendMessage로 보고하라.
```

### B. cli-lang

```
[병렬 세션 배정: 이 세션의 역할 이름은 **cli-lang** 다. 첫 응답 첫 줄에 "세션 cli-lang" 라고 밝혀라.]

계획 문서 `docs/superpowers/plans/2026-09-01-en-locale-residual-parallel-plan.md`를 먼저 읽어라. 소유는 `packages/cli/**`·`packages/mcp/**` 뿐이다. 그 밖은 읽기만.

과제: E26 + E27 잔여 — CLI/MCP에 `lang`을 배선한다(위원장 판정 2026-09-01: 문서 봉인 기각, 기능 이식).

현황:
- `packages/cli/src/commands/route.ts:73-75`에 "transit·walk는 V1 국문 전용"이라는 **낡은 주석**이 남아 `lang`을 car에만 싣는다. 서버는 이미 `/api/route/walk`·`/api/route/transit`·`/api/station/{meta,timetable,subway-arrival,subway-arrival/nearby}` 전부 `lang`을 받는다(`src/lib/lang-param.ts`, 미지 값 400).
- 공유 카탈로그 `endpoint-catalog-shared.ts`의 `route-walk`·`route-transit`·`station` 계열 params에 `lang`이 없다.

할 일:
1. `route walk`·`route transit`·`station` 계열에 `lang` 전달. 낡은 주석 삭제(남기면 다음 사람이 또 믿는다).
2. 카탈로그 params 갱신 — **cli·mcp 両미러를 같은 커밋에서 동일하게**(drift 테스트가 byte 해시로 강제한다).
3. 포매터 확인: 카탈로그 항목을 더하면 `FORMATTERS`(`packages/cli/src/lib/formatters.ts`)에도 등록해야 한다. 빠뜨리면 **text 모드에서만** 통짜 JSON이 나오고, 파이프로 돌린 검증은 비-TTY라 JSON 모드가 정상이라 못 잡는다. `formatter-coverage.test.ts`가 강제한다.
4. 실호출로 en 응답 확인(`--output text` 명시 — 이 함정이 정확히 여기 있다).
5. 버전은 올리지 마라. **npm 발행은 이 계획 밖이고 별도 판정이다**(외부 발신 = 하드 스톱). 코드 통합까지만 한다.

⚠ 테스트는 루트 `npm run test:run`이 `packages/**`를 안 돈다(include가 `src/**`·`scripts/**/*.test.mjs`뿐). 반드시 `cd packages/cli && npx vitest run`, `cd packages/mcp && npx vitest run`을 따로 돌려라 — 루트에서 이름만 넘기면 "No test files found"가 통과가 아니라 무실행이다.

문서 분배(CHANGELOG·BACKLOG E26 종결·E27 잔여 해당 줄) 후 rebase → ff push. 통합 시작·완료를 코디네이터에 SendMessage로 보고하라.
```

### C. en-polish

```
[병렬 세션 배정: 이 세션의 역할 이름은 **en-polish** 다. 첫 응답 첫 줄에 "세션 en-polish" 라고 밝혀라.]

계획 문서 `docs/superpowers/plans/2026-09-01-en-locale-residual-parallel-plan.md`를 먼저 읽어라. §2의 소유 파일 밖은 만지지 않는다.

과제: 영어 잔여 소품 5건. 서로 독립이니 하나씩 닫고 각각 커밋하라.

1. **노선명 표를 안 타는 자리 2곳**(`docs/BACKLOG.md` E27 잔여, 2026-08-31 doc-audit 확인)
   - `src/lib/place-lines/station-metro.ts`의 `호선` 접미 로컬라이즈(`subway.lineNumber`) — A26이 임시 처리한 자리를 `subway-line-names.ts` 표로 통일.
   - `src/components/SeoulMetroFacilities.tsx` 헤딩의 노선명 — 표를 타게 하고 `lang` 속성도 붙인다(그룹 줄엔 `hasHangul` 조건부 `lang="ko"`가 있는데 헤딩만 빠져 있다).
   - ⚠ `subway-line-names.ts` 자체는 읽기 전용이다.

2. **A30 `bike.availability` 가운뎃점**(`docs/BACKLOG.md` A30) — 6로케일 문자열의 `·`를 쉼표로. 접근성 헌장 §4: 가운뎃점은 일부 SR이 단어로 낭독한다.

3. **`/api/geocode/reverse`의 `lang` 통일**(코디네이터 판정) — 지금 `z.enum(["ko","en"]).catch("ko")`라 미지 값을 조용히 ko로 떨군다. `langParam()`(미지 값 400)으로 바꾼다. 소비자 전수 확인 후.

4. **수동 위치 라벨 병기**(`docs/BACKLOG.md` E27 잔여, 실페이지 실측 2026-08-31) — 비-ko 표시줄이 "Set location, 강동구청 (cannot verify)"로 남는다. 스토어에 `labelRoman` additive(`manual-location-store.ts` ↔ Kit `ManualLocation.swift`) + 표시줄 병기. **E28이 만든 `romanNameOf`·`bilingualName`을 그대로 쓴다**(새로 만들지 마라).
   ⚠ 웹 괄호 span(`aria-hidden`+`lang="ko"`)은 **접근성 객체의 마지막 노드**여야 한다 — 줄 가운데 두면 앞뒤 텍스트가 StaticText 둘로 갈린다(Chrome AX 실측).

5. **GTX-A 실호출**(`scripts/verify-odsay-lang.mjs` 4번째 경로 서울역→동탄) — 2026-08-31 ODsay 쿼터 소진(429)으로 미실측. 한글 없는 노선명이 `*Kor` 술어(`isKorLine`)를 통과하는지 확정. **또 429면 그 사실을 기록하고 넘어가라**(재시도 반복 금지). 코드 변경 없음.

각 건마다 테스트를 동반하고, 마지막에 a11y-auditor 점검(1·2·4가 낭독에 닿는다). 문서 분배 후 rebase → ff push. 통합 시작·완료를 코디네이터에 SendMessage로 보고하라.
```

## 6. 이 계획 밖 (백로그에 남는다)

- **npm 발행**(`cli-v*` 태그 push → 자동 발행) — 외부 발신이라 하드 스톱. B 통합 후 위원장 판정.
- **실승차·실보행 판정** — E16 축3 en 도보, E27 병기 한 객체, A 마일스톤의 en 대중교통 안내. 위원장 시간은 W2 마감(2026-09-04 05:00)이 먼저다.
- **iOS 줄 단위 언어 태깅**(E28-①) — 실기기 판정이 선행이라 코드 세션 대상이 아니다.
- **다음 언어 추가** — 영어 잔여가 닫히고 실사용 판정이 나온 뒤. 규모 실측은 §0.

## 7. 종료 상태

착수 기준 `c3c859e`. 코디네이터가 세션 보고를 받은 순서대로 적는다.

| 세션 | 상태 | 통합 SHA | 배포 | 자진 신고 |
|---|---|---|---|---|
| **B. cli-lang** | ✅ 종결 | `457e9c5`(커밋 4) | 없음(npm 발행은 §6) | 3건, 전부 승인 |
| **C. en-polish** | ✅ 종결 | `fb1aafa`(커밋 6, `457e9c5` 위 rebase) | 웹 자동 배포. iOS Swift 변경 0이라 락 불필요 | 6건, 전부 승인 |
| **A. transit-en-gate** | ✅ 코드 종결 | `a9e965d`(`df4b458` 뒤 문서 1 + 회귀 수정 1) | ⚠ **iOS 실험판 배포 미실행**(아래) | 5건, 전부 승인 — **그중 2건은 계획 결함**(아래) |

**리뷰·실행이 잡은 게이트 결함 3건**(이번 웨이브의 최고가치, 셋 다 "초록인데 대상에 닿지 않았다"):
- cli-lang이 쓴 카탈로그 검사가 **자기 자신만 보는 change-detector**여서 이 마일스톤이 고친 드리프트를 통과시켰을 것 → 라우트 소스 스캔 양방향 대조(`catalog-lang-drift.test.ts`)로 교체, 변이 3종 검출.
- ODsay 게이트가 **GTX-A lane을 한 번도 안 본 채** 46/46 초록(선정 5개 밖) → 급행과 같은 필수 표본으로 승격(`584b00c`). 배정은 "실행·결과 기록만"이었으나 범위를 넘은 것이 옳았다.
- transit-en-gate의 **계층별 fixture 모양 집합이 달라** 이음매가 무방비였다 — 투영 fixture엔 서울버스 모양이 있고 문장 fixture엔 없어 두 계층이 각자 초록인 채 합성 경로만 깨져 있었고, 그 결과 **en 대기 목록이 통째로 한국어로 떨어져 Task 1 전체가 도달 불가**였다(리뷰어 둘이 독립적으로 같은 BLOCKER). 종단 케이스 4건 + 변이 3건으로 봉합. ⚠ 판정: 두 리뷰어가 같은 결함을 잡은 것은 **계층 선택 문제가 아니라 결함이 두 축에 실제로 걸친 경우**다(spec 위반이면서 품질 결함, 결과가 기능 도달 불가). CLAUDE.md 3중 리뷰 규율의 "계층 선택 의심" 신호로 기록하지 않는다.

**웨이브 종료 뒤 얹힌 회귀 수정 1건**(`a9e965d`, a11y 재감사 검출): 승차 전 도보 문구를 **절반만 영문화**해 en 세션 한 흐름에서 같은 역이 두 이름으로 불렸다(`Walk to Cheonho` → `천호까지 200m` → `Arrived at Cheonho`). ⚠ **그 커밋 전에는 전부 한국어라 오히려 일관됐다** — 부분 적용이 무적용보다 나쁜 자리이고, 침묵 위험과 **반대 방향의 실패**다(둘 다 또렷이 들리는데 같은 곳인지 알 수 없다). A28의 "전부-아니면-원문" 원칙이 분류 축 밖에서도 성립한다는 사례. 원인은 아래 계획 결함과 같은 계열이다 — 구현자가 주석에 "`label:`은 조인·표시 겸용이라 한국어 유지"라고 적었는데 **조인 소비자가 0이었다**(본인 진단: 결론을 먼저 정하고 근거를 붙였다). 메모리 [[rationale-written-after-the-conclusion]].

**⚠ 코디네이터 계획 결함 2건**(자진 신고로 드러났으나 신고할 일이 아니었다):
- **§2 A 소유 목록에서 `/api/transit/track`·`transit-track.ts`·`TransitTrackService.swift`를 빠뜨렸다.** 실시간 추적 라우트가 대중교통 안내의 데이터 원천인데, 게이트를 열라고 하면서 그 문 뒤의 배관을 배정하지 않았다. 다음 계획에서 소유 목록을 만들 때는 "이 기능이 읽는 데이터가 어디서 오는가"를 한 단계 더 따라간다.
- **코디네이터의 리뷰 지적도 처방이 아니라 신호다.** spec §3.7의 "런타임 sentinel" 요구를 그대로 지시했는데, 세션이 실측해 보니 `enrichArrivalEn`이 표에서 값을 재생성해 주입분을 덮어써 그 테스트가 공허하게 통과했다. **지적 방향(서버가 `*En` 자리에 한국어를 싣는 축)은 실제로 뚫려 있었고**(`englishFieldOnly` fail-closed로 봉합), 틀린 것은 *어디에 변이를 넣을지*였다. 메모리 `mutation-proves-test-detection-power` 2026-09-01 갱신.

**남은 위원장 판정**(전부 BACKLOG에 근거와 함께 등재, 이 계획의 후속):
1. `docs/FIELD-TEST.md` §4-6 — 웹 en 표시줄 병기 청취(괄호가 줄 끝이 아니라 문장 중간인 유일한 자리). 앉아서 가능.
2. E29 — CLI 자동차 브리핑의 en→ko 폴백 표기 부재(포매터 계약 변경이 선행).
3. `/api/route/car`·`/api/chat`의 `lang` 무검증 통일 여부 — `geocode/reverse`와 같은 계열이나 car는 `guidanceLang` 3-state가 이미 서 있고 chat `locale`은 6로케일이라 한 규칙으로 묶이지 않는다.
4. iOS `subway.lineNumber`가 es에서 "Línea 5"(웹은 "Line 5") + 수동 위치 라벨 iOS 병기. ⚠ **코디네이터 관찰**: 후보 ⓐⓑ가 둘 다 "en 통일" 전제인데 그것이 맞다 — 노선명을 es로 내려면 노선명 표의 es판(47개)이 필요하고 그것이 곧 §0이 추정한 "다음 언어 추가" 비용이다. 이 항목은 그 마일스톤의 축소판이지 이번 축이 아니다.

⚠ **iOS 실험판 배포는 실행되지 않았다**(2026-09-01). 코드는 main에 있고(`df4b458`) 같은 구성의 빌드도 BUILD SUCCEEDED지만, 배포 시점에 기기가 `unavailable`(USB 미연결)이라 `deploy-device.sh`가 exit 1로 멈췄다. **배포한 것처럼 닫으면 실승차 날 위원장이 옛 빌드로 걷고, 영어에서 안내 시작 버튼이 안 보이는 것을 "게이트가 안 열렸다"는 결함으로 적게 된다** — 실제로는 설치가 안 된 것이다. 그래서 `docs/FIELD-TEST.md` §5-6 머리에도 재설치 전제를 적었다(`5157e93`). 기기를 USB로 연결하고 잠금 해제한 뒤 아무 세션에서나 `CONFIGURATION=Experimental ./ios/deploy-device.sh` 한 줄이면 된다.
⚠ 코디네이터가 배포 락을 줄 때 본 `available (paired)`와 세션이 배포 직전에 본 `unavailable`은 **둘 다 각자 시점에 맞다**(그 사이 연결이 끊겼다). 기기 상태도 SHA와 같아서 **읽는 순간이 곧 스냅샷**이다 — 락 허가 시점의 관측을 배포 시점의 보증으로 넘기지 말 것.

**코디네이터 몫**: `AGENTS.md` 일괄 재생성(A 통합 후. B·C가 `CLAUDE.md`를 5줄 고쳤다) · 창 정리(`close-sessions.sh`) · 스킬 개정 제안 1건(아래).

**스킬 개정 후보 2건**(`parallel-sessions`, 웨이브 종료 시 반영 검토):

1. **§3 소실 대조에 역방향(`comm -13`)을 더한다.** 현행 규약은 순방향(`comm -23`, 원격에만 있는 줄)뿐인데, **상대가 절을 통째로 지운 편집**이 있으면 순방향으로는 "내가 그 삭제를 되살렸는지"가 보이지 않는다. 출처: en-polish가 자발적으로 돌려 확인(cli-lang의 `### E26` 삭제 위에 rebase, 되살린 줄 0).
2. **§2-1·§4에 "`idle`은 보고 도착을 뜻하지 않는다"를 더한다.** 출처: en-polish의 a11y 감사(2026-09-01), 세션 자신의 관측이고 코디네이터는 미검증. ⚠ **통합 보고의 "리뷰어 보고 2회 유실"은 정정됐다 — 유실이 아니라 지연이었다.** 감사자가 `ListAgents`에서 idle로 바뀐 뒤 몇 분 지나 final text와 답장이 한꺼번에 도착했고, 그 사이 무응답으로 판단해 재디스패치가 일어나 **중복 감사 1회**가 발생했다(두 감사자의 세 축 판정이 독립적으로 일치, 결함 0건이라 코드 판단은 불변). 그러므로 AUTONOMY §리뷰 계층의 "2회 실패 시 컨트롤러 직접 검증" 조항은 **발동하지 않았다** — 기록에 유실과 지연을 구분해 적는다. 실용 처방도 실측됐다: 디스패치 프롬프트에서 보고를 **파일로 Write**하게 하면(`scratchpad/<주제>-report.md`) 늦게 오는 메시지 채널과 경합하지 않고 `until [ -s "$f" ]`로 폴링 없이 도착을 판정할 수 있다(2차의 파일이 1차의 지연된 메시지보다 먼저 도착). 메모리 `sdd-subagent-final-report-sendmessage`에 갱신 완료.
3. **§4에 "배포 직전 확인은 배포하는 쪽이 다시 한다"를 더한다.** 락을 주는 쪽이 "지금 기기가 연결돼 있다"를 확인해도 받는 쪽이 빌드에 몇 분을 쓰면 그 사이 끊긴다(실측: 코디네이터가 `available (paired)`를 보고 락을 줬고, 세션이 배포 직전에 `unavailable`을 봤다 — 둘 다 각자 시점에 맞다). transit-en-gate가 배포 직전 자기 확인으로 무의미한 빌드를 막았다. **관측의 수명을 명시하지 않은 프로토콜 문제**이지 어느 쪽의 실수가 아니다.
   ⚠ **이 함정은 코디네이터에게도 걸린다** — 이 웨이브에서 코디네이터가 받은 `[Cross-session idle notice]` 역시 "그 세션이 보고를 마쳤다"의 증거가 아니다.
