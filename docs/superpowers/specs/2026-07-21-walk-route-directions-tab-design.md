# SPEC: 도보 길찾기(Tmap) + 길찾기 탭 신설 (2026-07-21)

> 배경 조사 정본: `docs/research/RESEARCH-2026-07-routing-enhancement.md`. 위원장 결정(2026-07-21): 길찾기 탭 신설 승인("복잡도 증가는 고민사항 아님, 앱 취지 정합이 우선"), iOS 4탭(채팅·검색·길찾기·내 주변) 개조. Tmap appKey 발급·실호출 검증 완료(보행자·자동차 단일 키).

## 0. 목표 (측정 가능한 성과)

1. **임의 두 지점 A→B 경로 조회가 얕은 진입으로 가능해진다**: 현행은 대중교통 한정, 검색→장소→브리핑→출발지 바꾸기 4단계(자동차는 불가, 채팅도 출발지 고정). 목표: 길찾기 탭 진입 → 도착지 입력 → 조회, 3동작.
2. **도보 수단 신설**: 지도 없이 완성 문장 턴바이턴("홍대입구역 9번출구에서 우회전 후 136m 이동")을 낭독. 시각장애인 1급 시민 정합의 최대 공백 해소.
3. **한 화면 수단 비교**: 대중교통·도보·자동차 3수단의 소요시간·요금(택시요금 포함)·배차간격을 한 번의 조회로 비교.

## 1. 범위

- A. `tmap-pedestrian` provider + `/api/route/walk` (서버)
- B. 웹 길찾기 뷰 (History API 뷰 전환, 출발/도착 2필드 + 3수단 결과)
- C. iOS 4탭 개조 + `DirectionsTabView`
- D. 장소 상세·검색 결과 → 길찾기 진입(도착지 프리필)
- E. 채팅 `get_walk_route` 도구, CLI/MCP 카탈로그 `route walk` 항목

## 2. Provider: `src/lib/providers/tmap-pedestrian.ts` (React 비의존)

- `POST https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1`, 헤더 `appKey: env.TMAP_APP_KEY`, `Content-Type: application/json`.
- body: `startX`/`startY`/`endX`/`endY`(⚠ **X=경도, Y=위도**, 파일 밖은 lat/lng 도메인, 카카오 navi와 동일 반전 주의), `reqCoordType`/`resCoordType`: `"WGS84GEO"`, `startName`/`endName` **필수**(응답 안내문에 미사용 확인, ASCII 상수 `"start"`/`"end"` 고정, 한글 넣으려면 URL 인코딩 필요하므로 넣지 않는다).
- 정규화 shape (`src/lib/types.ts`):
  ```ts
  interface WalkRouteStep { description: string; distanceMeters?: number }
  interface WalkRouteBriefing { distanceMeters: number; durationSeconds: number; steps: WalkRouteStep[] }
  ```
  Point feature의 `properties.description`만 추출(LineString 좌표는 버림, 지도 없음), 첫 Point의 `totalDistance`/`totalTime`(초). 정규화는 순수 함수 `normalizeTmapWalkRoute`(fixture 단위 테스트, 실캡처 응답 사용, 2026-07-21 길동 실호출분).
- ⚠ **`description` 완성 문장이 낭독 정본**. `turnType` 코드로 슬롯 재조합 금지(서울버스 `arrmsg1` 원칙 동형).
- **게이트 `hasTmapKey()`**: 키 없으면 도보 섹션·버튼·채팅 declaration·카탈로그 전부 0(死기능·mock 폴백 금지).
- 오류: HTTP 비200 throw → 라우트 502. **"경로 없음"류 응답 코드는 실호출로 관측된 것만 graceful(null) 처리**(ODsay `-98` 패턴, 추측 금지, 구현 중 비상식 거리 실호출로 확정).
- 캐시: `next: { revalidate: 3600 }`(보행 경로는 준정적, 일 1,000건 무료 쿼터 보호). 쿼터 초과 응답은 표준 오류 경로(throw → 502)로.

## 3. Route: `/api/route/car`·`/api/route/transit` 동형의 `/api/route/walk`

- GET `?origin=lat,lng&dest=lat,lng` (기존 `coordSchema`·zod 컨벤션 재사용), 응답 `{ result: WalkRouteBriefing | null }`.
- 거리 컷오프 없음(장거리 도보도 정직하게 시간 표시, 판단은 사용자).

## 4. 데이터 언어: **도보는 V1 ko 전용**

Tmap `description`은 한국어 전용이다. en 로케일(`prefersEnglish`)에서는 **도보 섹션을 노출하지 않는다**(자동차 NCP 영문·대중교통은 현행 유지). 근거: 안내문 전체가 한국어 산문이라 en 사용자 가치가 없고, 요약만 영어로 주면 "미리 듣기" 목적이 성립하지 않는다. en 도보는 카카오 신규 도보 API의 en 지원·안내문 유무 확인 후 후속(미확정 게이트 §RESEARCH 2번). `dataLocale`/`prefersEnglish` 경유로 분기(원시 `useLocale()` 직접 사용 금지).

## 5. 웹 길찾기 뷰

- **진입**: 홈 검색창 영역에 "길찾기" 버튼(`min-h-11`) → **History API 뷰 전환**(장소 상세와 동형: pushState·백버튼 복귀·포커스 이동). URL `?dir=` 파라미터로 출발/도착(좌표+표시명) 동기화(새로고침·공유 생존).
- **폼**: 출발지·도착지 2필드 + 스왑 버튼 + 조회 버튼.
  - 기본 출발지 = "현재 위치"(표시 텍스트, `awaitGeolocation()` 공유 스토어, `getCurrentPosition` 직접 호출 금지).
  - 각 필드의 장소 지정은 **기존 검색 자산 축소 재사용**: 장소(`/api/places`)+주소(`/api/address/search`) 병렬, 웹 폴백 섹션 없음. 후보 선택 시 좌표 확정.
- **결과**: 수단 섹션 순서 **대중교통 → 자동차 → 도보**(도보는 분량이 가장 많은데 검색 빈도는 가장 낮아 최하단, 위원장 실사용 결정 2026-07-22). 조회 버튼 클릭 시 3수단 `Promise.allSettled` 병렬, 수단별 독립 3-state("경로 없음" ≠ "조회 실패" ≠ 게이트 미노출).
  - 대중교통·자동차는 기존 브리핑 **결과 렌더부를 공용 추출해 재사용**: `TransitRouteBriefing`/`CarRouteBriefing`에서 결과 표시 하위 컴포넌트를 분리(export)하고, 장소 상세 쪽 기존 사용은 표시 결과 불변(byte-동등 수준) 유지. 폼·fetch 상태는 길찾기 뷰가 소유.
  - 도보는 신설 `WalkRouteBriefing` 컴포넌트: 요약 1문장(총 거리·시간) + `<ol>` step 리스트(한 step = `<li>` 한 텍스트 = 한 접근성 객체, `description` 그대로).
- **접근성**: 수단 섹션 이름은 `h3` heading(조회 버튼이 발견 경로이므로 region 불필요, heading은 수단 간 점프용). 통지는 단일 polite 합산(3수단 결과 요약 1회, `combinedLiveMessage` 패턴). 포커스는 전부 settled 후 첫 결과 heading으로 1회 이동. 조회 버튼은 `aria-disabled`+in-flight ref 가드.

## 6. iOS: 4탭 개조 + DirectionsTabView

- 탭 순서 **채팅 · 검색 · 길찾기 · 내 주변**(위원장 제안 유지). 시작 탭은 채팅 현행 유지(길찾기 승격 후 실사용 판정으로 재평가, 열린 논점).
- 새로고침 메뉴(`TitleMenu`) epoch 계열에 `directionsEpoch` 추가, 유휴 복귀 리셋 대상 포함.
- `DirectionsTabView`: 출발지·도착지 필드(탭하면 검색 시트, 기존 `SearchService` 재사용), 기본 출발지 "현재 위치"(권한 요청은 **조회 실행 시점**에만, 탭 진입만으로 팝업 금지, 기존 계약 동형), 스왑·조회 버튼, 결과는 웹과 동형(수단 heading `.isHeader` + 블록별 `Text`).
- **장소 상세·검색 행 진입**: "길찾기" 액션 → 도착지 프리필 + 길찾기 탭 전환(기존 `LaunchActionStore` 2단 소비 패턴 재사용). 웹은 장소 상세에 "길찾기" 버튼 → 뷰 전환+프리필.
- 다국어: 웹 `messages` 정본 → `messages-to-xcstrings` 파이프라인 + 키 린터 게이트(기존 절차). ko 전용 도보 섹션은 iOS에서도 동일 분기.
- VoiceOver 계약: 필드 라벨 "출발지"/"도착지"(내용-라벨 충돌 없는 명사), 결과 도착 통지는 단일 Announcement, 조회 중 상태는 조회 버튼 라벨 변화("조회 중"). 받아쓰기 마이크는 V1 제외(§8).

## 7. 채팅·CLI/MCP

- 채팅 도구 `get_walk_route` 추가: `destination` 문자열만(출발지=실제 `userLocation` 불변식 유지, 장소 앵커로 덮지 않음, 기존 길찾기 2종과 동형). 게이트 `hasTmapKey()` → `availableDeclarations()` 편입. systemInstruction 수정 불필요(도구가 준 필드만 원칙 기존 적용).
- CLI/MCP: `endpoint-catalog-shared.ts`에 `route walk` 항목 추가(両미러 동일, drift 테스트가 강제). CLI 버전 릴리스는 이 마일스톤 마감 시 1회(`cli-v*` 태그).

## 8. 제외 범위 (후속 백로그)

- **Tmap 자동차 provider**: 카카오(ko)·NCP(en) 유지. Tmap 자동차는 옵션 세분(무료우선·어린이보호구역 회피)·타임머신이 필요해질 때 후속(키는 이미 커버).
- **카카오 신규 도보·자전거 API**: 실호출 스키마(안내문 유무)·dodo 공유 키 쿼터 영향 확인 후 보완재 검토.
- **en 도보**(§4), **길찾기 탭 받아쓰기 마이크**(기존 검색 탭 경유로 대체 가능), **채팅 임의 출발지 파라미터**(LLM 지오코딩 날조 리스크 검토 필요), **역 상세 보강 3종**(엘리베이터 `tbTraficElvtr`·음성유도기 seed·첫차막차 TAGO, 별도 spec), **ITS 돌발 브리핑**(its.go.kr 가입 후, 추후 과제 확정 2026-07-21).

## 9. 실호출 머지 게이트 (fixture green ≠ 실계약)

1. 도보 provider: 길동→강동역(기검증 재확인) + 도심 밖 1건(커버리지) + 비상식 거리 1건(경로 없음 코드 확정).
2. 웹 뷰 E2E: 현재 위치 출발 조회 / 임의 출발지(주소 검색) 조회 / 장소 상세 프리필 진입 / `?dir=` 새로고침 복원. 3수단 병렬 결과·부분 실패 3-state.
3. en 로케일: 도보 섹션 미노출 + 자동차(NCP)·대중교통 현행 유지.
4. iOS: 시뮬레이터 AX 덤프(수단 heading·step 블록 분리) + 실기기 VoiceOver 게이트(위원장): 4탭 낭독, 필드→검색 시트→프리필→조회→결과 heading 점프.
5. 채팅: "여기서 강동역까지 걸어서 얼마나 걸려?" 실호출(placeContext 유/무).
6. 회귀: 장소 상세 기존 자동차·대중교통 브리핑 표시 불변, 검색 탭·내 주변 무영향.

## 10-A. 보강 계약 (설계 적대 검토 반영, 2026-07-21 codex)

구현이 반드시 지켜야 할 추가 계약. 원 섹션과 충돌 시 이 절이 우선한다.

1. **출발/도착 필드는 원자 상태**: `{ kind: "current" | "place", label, coord | null }`. 라벨 텍스트 편집 즉시 `coord`를 무효화(표시명만 남고 옛 좌표로 조회되는 결함 차단). 스왑·프리필·URL 복원 모두 이 원자 단위로만 이동.
2. **조회 경합·대기 상한**: request-id ref로 stale 응답 폐기(기존 `?q=` 검색 패턴 준용) + 수단별 fetch에 timeout(15초, AbortController). 새 조회 시작 시 이전 조회 abort. 포커스 이동은 최신 세대의 settled에만.
3. **`/api/route/walk` IP 레이트리밋**: 기존 `checkChatRateLimit` 패턴 재사용(60초 10회). 쿼터(일 1,000건) 고갈 방어의 1차선. transit·car 기존 라우트는 현행 유지(회귀 방지, 후속 검토).
4. **`?dir=`에 현재 위치 좌표 직렬화 금지**: `kind:"current"`는 토큰 `cur`만 기록하고 복원 시 재측위. 명시 선택한 장소·주소만 좌표+표시명 직렬화(개인 위치의 URL·기록·Referer 잔존 차단). 불량·부분 `?dir=`은 zod 파싱 실패 시 빈 폼으로 폴백(오류 화면 없음).
5. **정규화 런타임 검증**: `totalDistance`/`totalTime` 유한 양수 아님·steps 0개면 결과를 만들지 않고 throw(→502). 시각장애 사용자에게 깨진 경로를 확정 낭독하는 것이 최악 경로다.
6. **포커스·통지 확정**: 결과 heading은 `tabIndex={-1}` 부여 후 **첫 번째 "성공" 수단의 heading**으로 이동(성공 0건이면 포커스 이동 없음 + polite 오류 통지 1회). iOS는 heading trait + `AccessibilityNotification` 포커스 지정(`.isHeader`만으로 이동 안 됨).
7. **게이트 경계**: 웹 UI 노출은 서버 컴포넌트에서 `hasTmapKey()` 판정을 boolean으로 내리는 기존 `canShowChat` 패턴. 라우트 자체도 키 없으면 404(직접 호출 방어). 채팅 dispatcher는 declaration 부재 + 실행부 게이트 이중(스테일 tool call 방어).
8. **iOS 탭은 안정 식별자 enum**(정수 index 금지): 탭 삽입으로 저장된 선택값·유휴 리셋 대상이 어긋나는 마이그레이션 결함 차단. `LaunchActionStore` 길찾기 액션은 payload에 대상 탭+1회 소비 계약(기존 2단 소비 규율 명시 적용). epoch 리셋 시 진행 중 Task cancel(늦은 응답이 초기화 화면을 되채우는 경합 차단).
9. **수단별 값 의미**: 없는 값은 생략이 정본(도보에 요금 없음, 자동차에 배차간격 없음, 0·"-" 표기 금지, 3-state 동형). 수단 간 숫자는 provider별 산출 기준이 다름을 전제로 "비교 표시"만 한다(합산·환산 금지).
10. **채팅 도구 출력 상한**: LLM에 주는 `data`는 요약+상위 20 step으로 캡(토큰 폭주 방지). 지오코딩 실패·위치 없음은 기존 길찾기 도구 2종의 오류 shape 동형.
11. **§2 문구 정정**: startName/endName은 ASCII 상수 고정이 계약의 전부다(JSON body는 UTF-8 그대로이며 URL 인코딩 요구는 GET 계열 문서의 잔재, 근거 불충분한 설명 제거).
12. **§5 순서 근거 명시**: 대중교통 → 자동차 → 도보 순서는 의도다. 도보 안내는 턴바이턴 문장이라 분량이 3수단 중 가장 많은데 실사용 검색 빈도는 가장 낮아(위원장 실사용 결정 2026-07-22), 정보가치가 낮은 도보를 최하단에 둔다.
13. **회귀 기준 교체**: 장소 상세 브리핑의 "byte-동등"은 검증 불가 표현이므로 **접근성 트리·표시 텍스트·동작 동등**으로 정의(추출 전후 AX 스냅샷 대조).
14. **마감 게이트 보강**: push 후 prod 실호출 smoke(`/api/route/walk` 1건 + 길찾기 뷰 로드)까지가 완료. 실기기 게이트에 위치 권한 거부·전 수단 실패·조회 중 스왑 시나리오 추가.

## 10. 함정 체크리스트 (전부 기실측·기문서화)

- Tmap X=lng/Y=lat 반전, `startName`/`endName` 필수, WGS84GEO 명시.
- `description` 정본·`turnType` 재조합 금지.
- 일 1,000건 쿼터: revalidate 3600 + 조회는 명시 버튼 트리거만(자동 재조회 금지).
- appKey는 "Any IP allowed" 유지(IP 제한 설정 금지, Vercel 가변 egress).
- env: `TMAP_APP_KEY`(로컬·prod 등록 완료). **env 변경 후 재배포 필수**(이번 마일스톤 push가 곧 재배포).
- 3-state·단일 polite live region·수단 heading·1줄=1객체(step 리스트)·`aria-disabled`+ref 가드.
- iOS 신규 문자열은 xcstrings 파이프라인+린터 통과 필수(런타임 무증상 누락 방지).
