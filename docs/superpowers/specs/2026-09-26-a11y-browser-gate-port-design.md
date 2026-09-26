# 실브라우저 접근성 회귀 게이트 이식 (D27)

- 출처: webfortd@606d16e `tests/a11y/`(`axe-helper.ts`·spec 5개·`axe-serious-baseline.json`) + `playwright.config.ts`. 이후 출처가 개정돼도 이 SHA 시점 계약을 따른다.
- 원장: `~/Mac-Projects/PORTS.md` `## → gildongmu` "실브라우저 접근성 회귀 게이트" 행. 백로그 `docs/BACKLOG.md` §7 D27, 계획 `docs/superpowers/plans/2026-09-26-backlog-sweep-6-parallel-plan.md` §1.
- 리뷰 게이트 판정: 설계 단계 적대적 리뷰 생략(새 불변식·외부 통합·비가역 변경 없음, 테스트 레인 추가뿐). 구현 뒤 spec-compliance·code-quality 리뷰.

## 1. 목적과 받는 쪽 현황

목적: 렌더된 화면의 표준 접근성 위반(대비·계산된 접근명·중복 id 등)을 결정론적으로 잡는 레인. 받는 쪽 현황(실측, `f8220b24`): `playwright`·`@axe-core` 의존성 0, 같은 일을 하는 게이트 0(`package.json` 의존성·scripts 실측, `src`·`scripts`에 axe·playwright 사용 0). jsdom 계약 테스트는 우리가 정한 계약을, `a11y-auditor`는 비결정적 LLM 감사를 한다. 기능어 검색으로도 부재가 확정돼 이식이다.

## 2. 전수 대조 판정표

| # | 자산(webfortd@606d16e) | 받는 쪽 현황 | 판정 |
|---|---|---|---|
| 1 | `axe-helper.ts` critical 0 하드 게이트 + serious 라우트별 baseline(신규·증가 fail, 감소 권고) | 없음 | **이식**. 상태 화면용으로 감사부를 `expectNoAxeViolationsOnPage(page, info, key)`로 분리(정적은 `expectNoAxeViolations`가 이동 후 호출). 실패 메시지에 actual 카운트, 첨부에 노드 target 5개를 더했다(baseline 직접 수정의 재료). 정적 라우트는 응답 200·최종 경로를 단언한다(404·리다이렉트 화면을 그 키로 감사하지 않게). 태그에 `wcag22aa`를 더해 `target-size`를 켠다(헌장 §1 터치 타깃의 근사 축) |
| 2 | `axe-serious-baseline.json`(`routes` 맵) | 없음 | **이식**. 키는 정적 라우트 문자열 또는 상태 화면 이름(`search-results`·`place-detail`·`nearby-hub`·`directions-result`) |
| 3 | `playwright.config.ts`(chromium 단일, workers 1, `fullyParallel: false`, `webServer: build && start`, `reuseExistingServer`) | 없음 | **이식 + 4곳 변경**: ①게이트 전용 포트 3100 + `reuseExistingServer: false`(3000의 개발 서버나 다른 worktree가 띄운 3100을 재사용하면 남의 빌드·키로 감사된다. CI 분기·`trace`는 CI 워크플로가 없어 뺐다) ②`webServer.env`에 키 게이트 17종 더미 값(전 섹션을 켠 화면을 `.env.local`과 무관하게 고정) ③`serviceWorkers: "block"`(`public/sw.js`가 가로챈 요청은 `page.route`에 안 보인다) ④`NEXT_TELEMETRY_DISABLED`(빌드 텔레메트리도 외부 발신이다). 지리 권한·좌표(서울시청)와 `ko-KR`을 `use`에 둔다 |
| 4 | `critical-routes.spec.ts`(정적 라우트 루프) | 없음 | **이식** → `static-routes.spec.ts`(`/ko`·`/en`·`/ko/about`·`/ko/privacy`·`/ko/offline`) |
| 5 | 상태 화면(출처엔 없음, 출처 omnibox 등은 기능 E2E) | 없음 | **신설** `state-routes.spec.ts` + `network.ts`(외부 출처 차단, `/api/**` fixture 또는 502) + `fixtures.ts`(mock provider 공공 장소 재사용). 검색 결과(`?q=`)·장소 상세(결과 항목 활성화)·내 주변 허브(`?panel=nearby`)·길찾기 결과(`?dir=` 복원 → "경로 조회" → 도보 줄 펼침, 대중교통·자동차는 502 실패 문장) |
| 6 | `package.json` `test:a11y` | 없음 | **이식**. `test:run`과 별개 레인(빌드+크롬). 도입 시점은 PR·릴리스 직전, 접근성 변경 뒤. `tests/a11y`·`playwright.config.ts`는 제외 없이 `tsc`(`**/*.ts` include)·eslint 대상이고, vitest include(`src/**`·`scripts/**`) 밖이다 |
| 7 | 핀 이후 드리프트 9d4b485 헬퍼 주석(갱신은 직접 수정) | 해당 없음 | **즉시 승계**(표현만, 이식본에 반영). 나머지 핀 이후 커밋 0f4d507(omnibox spec 신설·sidebar 보강)·d8bd757(대비 게이트)은 §3 |

## 3. 제외·종결

| 자산 | 판정 | 근거 |
|---|---|---|
| `admin-bar`·`atomic-samples`·`sidebar`·`voice-overlay` spec(핀 시점), `omnibox` spec(핀 이후 0f4d507) | 미채택 | webfortd 고유 표면의 기능 E2E. 이번 항목은 axe 감사 레인이다 |
| `test:a11y:ui` 스크립트 | 미채택 | `npx playwright test --ui`로 충분(쓰지 않을 옵션) |
| d8bd757 `tests/lib/color-contrast.test.ts`(CSS 토큰 전수 대비 계산) | 미채택 | 핀 이후 자산이고 원장 행 밖이다. 이 게이트 첫 실행에서 9화면 color-contrast 0건(판정 보류 0)이라 지금 올릴 근거가 없다 |

## 4. 첫 실행 결과와 검출력

- 9화면 모두 critical·serious 위반 0(게이트가 잰다). moderate·minor·incomplete 0은 첫 실행 때 임시 전 등급 스캔으로 한 번 관측한 값이다 → baseline은 전 화면 `{}`. 결함 항목(A50)은 세우지 않는다.
- 변이 주입(커밋 전 임시 spec, 삭제): `/ko/about`에 alt 없는 `img` → critical `image-alt`로 fail, 빈 링크 + 저대비 문단 → serious 신규 rule `color-contrast`·`link-name`으로 fail.
- 한계: axe는 헌장 §2 과잉 ARIA·한 줄 분절·포커스 착지·낭독 순서를 보지 않는다. 실기기 VoiceOver 판정을 대체하지 않는다.

## 5. 역이식

webfortd `playwright.config.ts`는 포트 3000 + `reuseExistingServer: !CI`라 로컬에 `next dev`가 떠 있으면 그 개발 서버를 감사한다. 정적 라우트 응답 상태 미단언(404 화면 감사)도 같은 계열이다. PORTS `## → webfortd`에 통보 행을 둔다.
