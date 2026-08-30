# 2026-08-31 비-ko 로케일 한국어 잔존 정리 — 병렬 세션 계획

코디네이터: gildongmu-9a(접수·판정 세션). 조사 원본은 이 세션의 3갈래 전수 조사(웹 i18n·iOS·데이터 원천, 실호출 포함)이며 아래 항목은 코디네이터가 표본 재검증했다(`"건너"` 판정·`RouteService.car` lang 기본값·seed `nameEn` 1,098/1,098·car 라우트 en 조건).

## §1 마일스톤·판정

| ID | 내용 | 웨이브 | 판정 |
|---|---|---|---|
| A26 | 비-ko 결함 묶음 6항(아래 §5 프롬프트가 정본) | 1 (즉시) | 불필요 |
| E27 | 대중교통 영문화(ODsay `lang=1`·노선명 영문 표·안내 봉인 재검토) | 2 | 위원장 판정 후 착수 — 결과는 이 절에 추기 |
| E28 | 장소명 영문 병기 정책(병기 형식·접근명 단일화·로마자·서울시 표기 seed) | 2 | 위원장 판정 후 착수 — 결과는 이 절에 추기 |

- 코디네이터가 정한 설계 사항(판정 아님): car ko 폴백은 N4의 의도된 결정이라 뒤집지 않고 **응답 언어 마커**로 정직화한다. `"건너"` 수정은 ko 동작 불변이 계약이다.
- W1(WebMCP, 2026-09-04 마감)과의 우선순위: 위원장이 본 건 착수를 직접 지시(2026-08-31). 파일 소유가 겹치지 않아 병행 무해(webmcp·PlaceSearch·DirectionsView는 A26 소유 밖).

## §2 파일 소유권 지도

**en-fix(웨이브 1) 소유:**
- iOS: `ios/GildongmuKit/Sources/GildongmuKit/GuideLiveRows.swift`, `RouteService.swift`, `ios/Gildongmu/Directions/BeaconModel.swift`(car `lang` 배선 한정), `ios/Gildongmu/Nearby/BusNearbyView.swift`, `ios/Gildongmu/BarrierFreeInfoSection.swift`, 両 `Localizable.xcstrings`(신규 키 추가만)
- 웹: `src/components/CarRouteBriefing.tsx`, `TransitRouteBriefing.tsx`, `src/lib/providers/tour-barrier-free.ts`, `seoul-elevator.ts`, `seoul-metro-facilities.ts`, `tago-subway.ts`, `src/lib/place-lines/*`, `src/app/api/route/car/route.ts`(언어 마커), `messages/*.json`(신규 키), lang="ko" 마크업 대상 컴포넌트(`PlaceCard`·`PlaceDetail`·`AroundNearby`·`LocationBar`·`LocalConditions`·`TransitGuidePanel`·station 계열)
- 공용 생성물 규약: `CHANGELOG.md`·`docs/BACKLOG.md`는 **자기 항목만**, rebase 후 `comm -23` 소실 대조. AGENTS.md류 생성물은 rebase 뒤 재생성.
- 코디네이터 소유: `docs/superpowers/plans/`(이 문서), E27·E28 판정 분배.

웨이브 2 소유권은 판정 확정 후 이 절에 추가한다(E27은 transit 계열, E28은 장소 표시 계열이라 상호 겹침 없을 전망이나 확정 시 재검토).

## §3 git 격리

```bash
git worktree add ~/gildongmu-wt/<name> -b feat/<name> main
# .env.local 복사, npm install(심링크 금지). 작업은 자기 브랜치, pathspec 커밋(git add -A 금지)
# 통합: git fetch && git rebase origin/main → 생성물 재생성 → 게이트(test:run·tsc --noEmit·lint) → git push origin feat/<name>:main (ff만, force 금지)
git worktree remove ~/gildongmu-wt/<name>
```

실기기·프로덕션 배포는 한 번에 한 세션. iOS 실기기 배포는 웨이브 1에서는 하지 않는다(코디네이터 보고만).

## §4 웨이브

- **웨이브 1**: en-fix 단독(즉시).
- **웨이브 2**: E27·E28 — 위원장 판정 확정 후 코디네이터가 착수 프롬프트를 이 문서에 추가하고 세션을 띄운다.

## §5 세션별 착수 프롬프트

### en-fix (웨이브 1)

프롬프트 전문은 착수 시점 파일로 전달했고 요지는 다음과 같다(전문과 상충 시 전문 우선):

1. **[안전] iOS `GuideLiveRows.swift` `isCrossingStep`**: `description.contains("건너")` 요구로 en 도보 안내(서버 `walk-guidance-en.ts` 영어 문장)에서 횡단 유닛이 절대 판정되지 않는다. 파일 상단 주석의 "건너" 요구 근거를 먼저 이해하고 언어 무관 판정으로 수정. ko 동작 불변. 웹 상당 코드 유무 확인.
2. **iOS `RouteService.car` `lang` 필수 인자화** + `BeaconModel` car 조회·ETA 재조회 배선(walk와 같은 규율, [[no-default-for-safety-parameters]]).
3. **웹 car 라우트 언어 마커**: en 요청의 ko 폴백(NCP 키 부재·`via`)을 응답 필드로 정직화, 소비자는 ko면 `lang="ko"` 표기. ko 폴백 자체는 불변(N4 의도 결정). additive 스키마(CLI/MCP 비파괴).
4. **웹 경로 카드 오류 낭독**: `CarRouteBriefing`·`TransitRouteBriefing`이 서버 한국어 error 문자열을 live region에 그대로 낭독 → `useVoiceRecorder`의 "HTTP status로 코드 결정" 선례로 `t()` 문장 교체(6로케일).
5. **서버 합성 한국어 i18n화**(전부 additive, 기존 필드 유지): 무장애 라벨 27종은 응답 `key`→클라 `t()` 매핑(미지 key는 서버 label 폴백+`lang="ko"`), 엘리베이터 위치 합성 문장은 구조화 필드 추가+클라 조립, `seoul-metro-facilities` "휠체어 접근 가능"·`${line}호선`, `tago-subway` `${t}선` 동형, iOS `BusNearbyView` "N정류장 전" 하드코딩 → 로컬라이즈 키. ⚠ 노선명 자체의 영문화("2호선"→"Line 2")는 E27 소관 — 여기서는 우리가 덧붙인 접미·조립문만.
6. **웹 `lang="ko"` 마크업 보강**: PlaceCard(이름·분류)·PlaceDetail(분류)·AroundNearby(헤딩·overview 삽입·항목)·LocationBar 주소·LocalConditions(영역명·측정소명)·station 계열 노선명·TransitGuidePanel. 헌장 "한 줄=한 객체" 준수 — 이미 별도 블록·줄인 곳만 속성 부여, 새 분절 생성 금지(분절이 필요해 보이면 건너뛰고 보고).

리뷰는 별도 컨텍스트(요구사항+diff만), a11y-auditor 포함. 리뷰 통과 후 ff push(자동 배포). 통합·완료는 SendMessage로 코디네이터(gildongmu-9a)에 보고, 소유권 밖 파일 자진 신고.

## 종료 상태

(웨이브 종료 시 추기)
