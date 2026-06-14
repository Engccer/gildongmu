# 길동무 v2 업그레이드 설계

작성일: 2026-06-14
상태: 승인됨 (사용자 구두 승인 2026-06-14)

## 1. 배경과 목표

길동무는 dodo-planet의 사이드 프로젝트이자 국내 서비스 API 실험실로 시작했다. 그동안 검증·문서화한 자산(카카오 로컬·모빌리티, TourAPI, NCP Maps, **한국철도공사 역 편의시설**)이 충분히 쌓여, 일상에서 쓸 만한 접근성 우선 내비게이션 앱으로 발전시킨다.

**비전**: 채팅 + 검색을 양 축으로 하는 미니멀 대화형 내비게이션. **이번 패스에서 채팅은 배제**하고, 검색 축의 UI를 대폭 개편한다. 단 구조는 향후 채팅을 같은 축에 얹을 수 있게 둔다.

**측정 가능한 성과**:
- 단일 검색창에서 검색 → 결과 → 장소 상세까지 스크린 리더만으로 완결.
- 이미 검증됐으나 화면에 없던 **역 교통약자 편의시설**이 상세 화면에 노출된다.
- `/ko` `/en`이 각각 단일 언어로만 표시된다(현재의 한/영 혼용 제거).
- 한 번 고른 언어가 재방문 시 유지된다.

## 2. 범위 (확정)

**정보 구조**: 통합 검색 → 장소 상세 집약 (A안). 입력 지점은 끝까지 검색창 하나.

**이번 패스 자산**: 키가 동작 확인된 것만 연동.
- 장소 검색 (카카오 로컬 + en TourAPI 병합) — 기존
- 자동차 경로 텍스트 브리핑 (카카오모빌리티) — 기존
- 주소·우편번호 지오코딩 — 기존
- **역 교통약자 편의시설 (한국철도공사 15125774)** — 신규 노출

**제외(다음 패스)**: KRIC 2종(승인 대기), TAGO 시내버스·서울 빠른하차(키 미발급), 채팅 인터페이스, 지도 시각 레이어.

## 3. 정보 구조 / 화면 흐름

```
검색창(/ko · /en) ──▶ 결과 목록 ──▶ 장소 상세
                      칩 필터       길찾기 딥링크
                      장소 카드     자동차 경로 브리핑
                                    역 교통약자 편의시설(역일 때)
```

- **검색창**이 유일한 입력 지점. 검색어는 `?q=`로 URL 동기화(공유·새로고침 보존).
- **결과 목록**: 카테고리 버킷(관광·음식·쇼핑·숙박·교통·기타) 칩으로 필터. 칩은 "현재 결과 안에 존재하는 버킷"만 표시. 기본은 전체.
- **장소 상세**: 별도 서버 라우트가 아니라 **같은 페이지 내 뷰 전환 + History API**.
  - 근거: 카카오 로컬 API에 "ID 단건 조회"가 없다. 검색이 이미 메모리에 든 `Place` 객체로 상세를 그리면 추가 호출이 없고 안전하다.
  - 상세 진입 시 `history.pushState`로 항목을 얹어 브라우저/안드로이드 백버튼이 목록으로 복귀.
  - 진입 시 포커스를 상세 제목(h1/h2)으로 이동, `aria-live`로 전환 통지.
  - **알려진 한계**: `?place=`로 딥링크 새로고침 시 메모리에 결과가 없으면 상세를 못 그린다. 이번 패스에서는 상세를 "결과에서만 도달" 가능으로 두고, 딥링크 직접 진입은 목록(또는 `q` 재검색)으로 graceful 폴백. 문서에 명시.

## 4. i18n 혼용 해결

- `/en`에서 제목·메타·결과가 영어로만 나오도록 잔여 한글 누출 제거. (en.json은 이미 영문 — 코드 경로에서 ko 문자열 하드코딩/혼입이 없는지 점검.)
- **언어 전환기**(헤더): next-intl `Link` + `usePathname`로 현재 경로·`?q=`를 보존한 채 `/ko`↔`/en` 전환. `aria-current`로 현재 언어 표시, 44px 타깃.
- **선택 기억**: next-intl 미들웨어가 로케일 프리픽스 네비게이션 시 `NEXT_LOCALE` 쿠키를 설정 → 재방문 시 유지. 첫 방문 기본값은 Accept-Language(이미 켜진 `localeDetection`).
- 영문 UI에 한국어 보조 텍스트가 남는 경우(예: 카카오 한글 주소 fallback) `lang="ko"` 부여 — 스크린 리더가 올바른 언어로 읽게. (기존 PlaceCard 패턴 유지·확장.)

## 5. 새 자산 — 역 교통약자 편의시설

- **provider** `src/lib/providers/korail-facilities.ts` (React/Next 비의존, 이식성 유지).
  - 입력: 역 이름 또는 좌표. 출력: 정규화된 `StationFacilities` 타입.
  - data.go.kr `apis.data.go.kr/B551457/convenience`의 `/weekPersonFacilities`(교통약자: 장애인화장실유무 `pwdbs_tolt_estnc`·휠체어리프트수 `whlch_liftt_cnt` 등), 필요 시 `/stationFacilities`·`/parkingLots`·`/codes` 병행.
  - 역 이름 → 역 코드 매핑: `/codes` 또는 로컬 캐시(406역). 실제 요청 파라미터는 구현 시 실호출로 확정(샌드박스 비활성화 필요 — `dangerouslyDisableSandbox`).
- **api route** `src/app/api/station/facilities/route.ts` — 서버 전용 키로 호출.
- **컴포넌트** `StationFacilities` — 상세 화면에서 텍스트 정본으로 표시(장애인화장실 유무·수, 휠체어리프트 수, 엘리베이터, 주차장 등). 지도 없이 완결.
- **역 판정**: `Place`가 역인지 — 카테고리에 교통/지하철/철도/기차 포함 또는 이름이 `역`/`Station`으로 끝남. 매칭 실패 시 섹션 생략(에러 아님, graceful degrade — "가짜 실데이터 금지" 원칙대로 데이터 없으면 표시 안 함).
- **한계**: 철도공사 키는 KORAIL 운영역(수도권 전철 일부 + 전국 일반철도) 중심. 서울교통공사 1~9호선 전용역은 KRIC/서울 데이터(다음 패스) 전까지 미커버 — 매칭 실패로 자연 처리.

## 6. 컴포넌트 분해 (각 단일 책임)

- `Header` + `LanguageSwitcher` — 사이트 제목·언어 전환.
- `SearchBar` — 검색 입력·제출(기존 form 로직 분리).
- `ChipFilter` — 카테고리 버킷 필터 칩.
- `ResultList` / `PlaceCard` — 결과 목록·카드(리디자인, 상세 진입 버튼).
- `PlaceDetail` — 상세 뷰 컨테이너(포커스·History 관리).
- `RouteLinks` — 네이버·카카오 딥링크(기존 PlaceCard에서 추출).
- `CarRouteBriefing` — 기존 유지.
- `StationFacilities` — 신규.

`src/lib/`는 React/Next 비의존 유지(dodo-planet 이식성). 뷰 전환·History·포커스는 클라이언트 컴포넌트 계층에.

## 7. 비주얼 디자인

- Tailwind v4 토큰(globals.css): 중립 베이스 + 접근성 대비(WCAG AA) 통과 단일 액센트, 라이트/다크 자동(`prefers-color-scheme`).
- 라벨 이모지 금지 → `lucide-react` 아이콘(`aria-hidden`, 텍스트 라벨 병기). lucide-react 의존성 추가.
- 44px 타깃·`:focus-visible`·`aria-disabled`(disabled 대신) 패턴 유지.
- Vercel 프리뷰 배포로 시각 이터레이션(클린·미니멀). Vercel 플러그인 활용.

## 8. 테스트 전략

- **게이트 테스트**(Vitest, 매 커밋): provider 파싱·역 매칭 로직·카테고리/칩 필터·언어 전환 경로 보존·딥링크. 결정적·로컬·무료.
- 실 API 호출 테스트는 게이트에 넣지 않음(키·네트워크 의존). provider는 fixture 응답으로 파싱 검증.
- a11y-auditor 서브에이전트로 마일스톤별 접근성 점검.

## 9. 마일스톤 (subagent-driven)

각 마일스톤 = 게이트 테스트 동반, 끝에 `npm run test:run` + `npm run lint` + `npm run build` 통과.

1. **M1 i18n·셸**: 레이아웃 셸, `Header`/`LanguageSwitcher`(쿠키 유지·경로 보존), 제목/메타 한영 분리, 디자인 토큰·globals.css 정비, lucide-react 추가. 테스트: 언어 전환 경로/쿼리 보존.
2. **M2 결과 UX**: `SearchBar`·`ChipFilter`·`ResultList`/`PlaceCard` 분리·리디자인. 테스트: 칩 필터링.
3. **M3 장소 상세**: `PlaceDetail` 뷰 전환 + History + 포커스/aria-live, `RouteLinks`·`CarRouteBriefing` 이전. 테스트: 상세 진입/복귀 상태.
4. **M4 역 편의시설**: `korail-facilities` provider + `api/station/facilities` + `StationFacilities` + 역 매칭. 테스트: provider 파싱·역 판정. 실호출 검증(샌드박스 off).
5. **M5 마감·검증**: Vercel 프리뷰 디자인 이터레이션, a11y-auditor, codex-rescue 마일스톤 리뷰(diff 직접 주입 방식), build/lint/test, 커밋·푸시·배포.

## 10. 리스크·미해결

- 철도공사 API 실제 요청 파라미터(역 코드 lookup 방식)는 M4 실호출로 확정. 문서의 필드명(`pwdbs_tolt_estnc` 등)은 검증된 값.
- 카카오 place ↔ 철도역 매칭은 이름 정규화 기반 best-effort. 오매칭 방지를 위해 역 코드 캐시와 대조.
- 딥링크 새로고침 상세 복원은 이번 패스 비목표(§3 한계).
