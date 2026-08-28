# WebMCP W2 배포본 실호출 검증 보고서 (2026-08-29)

> 시점 고정 실측 기록. 대상은 2026-08-29 KST에 배포돼 있던 `https://gildongmu.dodoplanet.space/ko`다. 현재 설계 정본은 `docs/superpowers/specs/2026-08-29-webmcp-wave2-design.md`, 열린 작업은 `docs/BACKLOG.md` W2를 따른다.

## 0. 판정 요약

**부분 통과.** 이동 계획 보조 7개 도구의 발견, 상시 등록, 화면 자가 이동, 불투명 `ref` 연쇄, `planId`와 `routeKey` 연쇄, 1,500자 출력 상한, 좌표 비노출, 단일 축 페이지네이션은 배포본에서 동작했다. 다만 `get_place_info({axes:["facilities"]})`의 첫 호출은 코레일 시설과 도시철도 시설이 같은 60초 예산 버킷을 순차 소비하여 도시철도 쪽을 항상 `cooldown`으로 만든다. 약 60초 뒤 같은 문서에서 재호출하면 회복되지만, 첫 호출 완결성과 응답 시간 계약은 통과하지 못했다.

| 축 | 판정 | 근거 |
|---|---|---|
| 도구 7개 발견 | 통과 | 설계 정본과 이름 집합 일치 |
| 화면 전환 뒤 상시 등록 | 통과 | 홈, 장소 상세, 길찾기에서 매번 7개 유지 |
| 검색에서 장소 정보 연쇄 | 통과 | `search_places`의 `ref`를 `get_place_info`가 해석 |
| 검색에서 길찾기 연쇄 | 통과 | 같은 `ref`를 `plan_directions.toRef`로 사용 |
| 경로 상세 연쇄 | 통과 | `planId`와 `routeKey`로 대중교통 상세, `planId`로 도보 단계 조회 |
| 1,500자 상한과 페이지네이션 | 통과 | 서울역 시설 7개 그룹을 `offset:0`, `offset:6` 두 페이지로 회수, 최대 1,483자 |
| WebMCP 출력 좌표 비노출 | 통과 | 좌표 키, 쿼리 이름, 십진 좌표쌍 없음 |
| 시설 축 첫 호출 완결 | 실패 | 도시철도 시설이 3회 모두 약 60초 `cooldown` |
| VoiceOver 착지와 낭독 | 미확인 | Chrome 자동화로 실제 음성을 판정할 수 없음 |
| 호스트 발화와 페이지 통지 경합 | 미확인 | ChatGPT 호스트 음성과 VoiceOver 실청취 필요 |

## 1. 검증 환경과 범위

- 시각: 2026-08-29 00:57~01:10 KST. 자정 이후 조건에서 수행했다.
- 페이지: `https://gildongmu.dodoplanet.space/ko`
- 브라우저: Chrome 151, WebMCP 기능 활성화
- 호출 표면: Chrome DevTools MCP의 `list_webmcp_tools`, `execute_webmcp_tool`, 화면 snapshot
- 에이전트 런타임: Codex CLI 0.149.1의 일회성 검증 세션
- 변경 행위: 로그인, 저장, 외부 발신, 프로젝트 파일 변경 없음
- 호출 범위: 장소 검색 4회 안팎, 장소 정보와 시설 조회, 길찾기 1회. 쿼터를 소량만 사용했다.

이 검증은 배포 페이지가 노출한 WebMCP 도구와 그 결과를 대상으로 한다. 일반 주소창 URL, DOM 자동화 능력, 서버 MCP는 WebMCP 출력 판정에서 분리했다.

## 2. 호스트별 도구 발견

### 2.1 Codex 인앱 브라우저

같은 배포 URL에서 현재 Codex 인앱 세션이 노출한 도구 목록에는 사이트 도구가 없었다. 이는 페이지의 `document.modelContext` 부재를 증명하지 않는다. 호스트가 사이트 도구를 모델 호출 표면으로 전달하지 않은 상태와 페이지 등록 실패는 별개다.

### 2.2 Chrome WebMCP 실험 환경

Chrome에서는 다음 7개가 정확히 발견됐다.

1. `describe_app`
2. `search_places`
3. `get_place_info`
4. `plan_directions`
5. `get_transit_route_detail`
6. `get_route_steps`
7. `read_current_view`

`open_directions`, `focus_item`, 안내 도구 3개, 보행 인프라 도구는 없었다. W2에서 삭제한 집합과 일치한다. 홈에서 검색한 뒤 장소 상세과 길찾기로 이동할 때마다 도구 목록을 다시 읽었고, 추가 등록이나 철회 없이 같은 7개가 유지됐다.

## 3. 기본 연쇄 호출

### 3.1 앱 설명과 초기 상태

`describe_app({})`는 `currentView:"home"`, 도구 7개 모두 `available:true`, 장소 정보 축 5개 모두 `available:true`를 반환했다. `requires`와 `produces`는 다음 연쇄를 설명했다.

```text
search_places
  -> ref
  -> get_place_info
  -> plan_directions.toRef
       -> planId, routeKey
       -> get_transit_route_detail / get_route_steps
```

초기 `read_current_view({})`는 검색어가 비어 있고 결과 수가 0인 `view:"home"`을 반환했다.

### 3.2 `search_places`: 강동역

입력:

```json
{"query":"강동역","sort":"accuracy"}
```

핵심 결과:

- `ok:true`, `view:"home"`, `branches.places:"done"`, `branches.addresses:"done"`, `branches.web:"skipped"`
- 첫 장소 `강동역 5호선`, `isStation:true`
- 장소 `ref` 발급
- 장소 19건, 주소 4건 중 출력 상한에 맞춘 일부 항목 반환
- 화면 snapshot에서도 검색어, 결과 수, 강동역 항목 확인

`ref`는 문서 nonce와 검색 세대를 포함하는 일회성 식별자라 보고서에 영구 입력값으로 고정하지 않는다.

### 3.3 `get_place_info`: 강동역 기본 정보와 시간표

입력 모양:

```json
{"ref":"<search_places가 반환한 강동역 ref>","axes":["basic","timetable"]}
```

핵심 결과:

- `view:"place"`, `name:"강동역 5호선"`, `isStation:true`
- `basic.status:"done"`
- 도로명 주소, 지번 주소, 전화번호, 노선과 운영기관 반환
- `timetable.status:"done"`, `basis:"평일 기준"`
- 첫차 `05:30 마천행`, 막차 `익일 00:50 상일동행`
- 화면 snapshot의 장소명, 주소, 전화, 시간표와 일치

도구가 홈에서 장소 상세로 스스로 이동했고, 이동 뒤에도 7개 도구가 유지됐다.

### 3.4 `plan_directions`: 길동역에서 강동역

첫 입력:

```json
{
  "toRef":"<같은 강동역 ref>",
  "from":"길동역"
}
```

첫 결과는 `reason:"needsDisambiguation"`, `field:"from"`과 후보 목록이었다. 정확한 `길동역 5호선` 후보의 `candidateId`를 넣어 한 번 재호출했다.

재호출 핵심 결과:

- `ok:true`, `view:"directions"`, `planId` 발급
- 출발지 `길동역 5호선`, 도착지 `강동역 5호선`
- 대중교통 `done`: 추천 4분, 환승 0회, 운임 1,550원, 도보 2분
- 도보 `done`: 1.062km, 12단계, 최단 대안 975m
- 자동차 `done`: 2.226km, 약 8분

`toRef`의 도착지 이름이 검색 결과와 최종 길찾기 화면에서 모두 `강동역 5호선`으로 일치했다. 텍스트 재검색 없이 검색 결과가 가리킨 장소를 목적지로 사용한다는 W2 게이트 ⑪의 데이터 축을 통과했다.

### 3.5 경로 상세

`get_transit_route_detail({planId,routeKey})`는 다음을 반환했다.

- 추천 경로 4분, 1,550원, 환승 0회
- 도보, 지하철, 도보의 3개 구간
- 길동에서 강동까지 수도권 5호선 1정거장
- 강동 하차 빠른 문 정보

`get_route_steps({planId,mode:"walk",offset:0,limit:10})`는 총 12단계 중 10개와 `nextOffset:10`을 반환했다. 단계 문장에는 역사 내 이동, 횡단보도 길이, 음향신호기 유무가 화면 문장과 같은 형태로 들어 있었다.

마지막 `read_current_view({})`는 `view:"directions"`, `phase:"settled"`, 세 수단 모두 `outcome:"done"`을 반환했다.

## 4. W2 게이트 ⑩: 장문 시설과 페이지네이션

### 4.1 대상과 첫 결과

`search_places({query:"서울역",sort:"accuracy"})`에서 `서울역 1호선`의 `ref`를 골라 다음을 호출했다.

```json
{"ref":"<서울역 1호선 ref>","axes":["facilities"]}
```

새 문서에서 같은 절차를 세 번 반복했다. 세 번 모두 첫 결과가 같았다.

| 내부 소스 | 상태 |
|---|---|
| Korail 시설 | `done` |
| 도시철도 시설 | `cooldown` |
| 시설 결합 상태 | `partial` |
| 도시철도 `retryAfterMs` | 약 59.4~59.9초 |

약 60초를 기다린 뒤 같은 문서와 같은 `ref`로 재호출하면 두 소스 모두 `done`으로 회복됐다. 따라서 자정 이후 외부 API 운영 중단은 원인이 아니다. 실제 시간대가 자정 이후였고, 동일한 외부 소스가 60초 경계 직후 정상 응답했다.

### 4.2 페이지네이션

축 하나와 `offset:0`을 명시하여 페이지 모드로 다시 직렬화했다.

| 호출 | compact JSON 길이 | 결과 |
|---|---:|---|
| `search_places` | 1,432~1,433 | 1,500자 이하, 좌표 없음 |
| 시설 첫 `partial` | 324 | 1,500자 이하, 좌표 없음 |
| 시설 `offset:0` | 1,223 | 그룹 6개, `nextOffset:6` |
| 시설 `offset:6` | 1,483 | 그룹 1개, 다음 offset 없음 |

회수한 도시철도 시설 그룹은 다음 7개다.

1. 엘리베이터 4곳
2. 에스컬레이터 5곳
3. 안전발판 1곳
4. 수어영상전화기 1곳
5. 교통약자 도우미 1곳
6. 장애인 화장실 1곳
7. 시각장애인 음성유도기 56곳

중복 없이 7개를 회수했고 마지막 페이지에 `nextOffset`이 없으므로 페이지네이션은 유한하게 끝났다. 페이지 모드는 `totalCount` 대신 `nextOffset`으로 진전을 나타내는 계약이므로 별도의 `groupsTotalCount`가 없는 것은 실패가 아니다.

## 5. 확인된 결함: 시설 복합 축의 내부 쿨다운 충돌

### 5.1 재현 절차

1. 새 문서에서 `search_places`로 시설 축이 있는 지하철역을 검색한다.
2. 반환된 역 `ref`로 `get_place_info({ref,axes:["facilities"]})`를 처음 호출한다.
3. `facilities.korail.status:"done"`, `facilities.metro.status:"cooldown"`, 결합 `status:"partial"`을 확인한다.
4. 약 60초 뒤 같은 입력을 재호출한다.
5. 두 소스가 모두 `done`으로 바뀌는 것을 확인한다.

서울역 1호선의 새 문서 3회에서 3회 모두 재현됐다.

### 5.2 원인

`src/lib/webmcp/tools/get-place-info.ts`의 흐름은 다음과 같다.

1. `facilities` 입력 축을 내부 키 `facilities`, `facilitiesMetro` 두 개로 확장한다.
2. 두 키를 모두 `stationFacilities` 예산 버킷에 매핑한다.
3. 두 키를 순차 실행한다.
4. 첫 키가 `checkBudget`을 통과하고 즉시 `consumeBudget`을 호출한다.
5. 두 번째 키가 같은 버킷을 검사하면 60초가 지나지 않았으므로 외부 fetch 전에 `cooldown`으로 끝난다.

따라서 실패는 외부 API, 자정, 역 데이터 유무와 무관한 클라이언트 내부 결정이다. 시설 축 하나가 논리적 호출 한 번인데 그 안에서 같은 버킷을 두 번 소비하는 것이 직접 원인이다.

### 5.3 영향

- 에이전트는 첫 질문에서 완결된 시설 정보를 받지 못한다.
- 정상 회복에 약 60초와 추가 도구 호출이 필요하다.
- `facilities.status:"partial"`이라 실패가 조용히 숨지는 않지만, 사용자가 한 번 요청한 축을 한 호출로 조회한다는 기대를 깨뜨린다.
- 긴 시설 역의 1,500자 페이지네이션 자체는 동작하지만, 그 앞에 불필요한 60초 대기가 붙는다.

### 5.4 수정 완료 조건

1. 새 문서의 첫 `get_place_info({axes:["facilities"]})`에서 Korail과 도시철도 내부 소스가 모두 실행된다.
2. 시설 복합 축 한 호출은 `stationFacilities` 예산을 한 번만 소비한다.
3. 같은 축의 정착 데이터를 `offset`으로 재직렬화할 때는 예산을 소비하지 않는다.
4. 첫 호출 직후 새 `refresh:true` 요청처럼 실제 추가 fetch를 요구하는 별도 호출은 기존 60초 쿨다운을 지킨다.
5. 두 내부 소스가 모두 `idle`인 회귀 테스트를 추가하여, 두 `ensureLoaded`가 실행되고 둘째가 내부 `cooldown`이 되지 않음을 단언한다.
6. 배포본 서울역 1호선에서 첫 호출 `facilities.status:"done"`, 페이지 `offset:0`과 후속 offset 전량 회수를 다시 확인한다.

## 6. 자동 테스트 대조

다음 범위의 Vitest를 같은 checkout에서 실행했다.

```text
src/lib/webmcp
src/hooks/__tests__/useWebMcpTools.test.tsx
src/components/__tests__/DirectionsWebMcp.test.tsx
src/components/__tests__/PlaceDetailWebMcp.test.tsx
src/components/__tests__/PlaceSearchWebMcp.test.tsx
```

결과는 테스트 파일 19개, 테스트 108개 전부 통과였다. 비실패 경고는 Node `module.register()` deprecation과 jsdom 작업자의 localStorage 실험 경고였다.

자동 테스트가 시설 결함을 놓친 이유도 확인했다. 기존 `get-place-info` 복합 시설 테스트는 Korail을 이미 `done`, 도시철도를 이미 `empty`로 게시한 상태를 사용한다. 두 내부 소스가 동시에 `idle`인 첫 로드와 공유 버킷 소비 순서를 실행하지 않는다.

## 7. 좌표와 URL 관찰

모든 WebMCP 반환 JSON에서 다음을 검사했고 발견되지 않았다.

- `lat`, `lng`, `x`, `y` 좌표 키
- 좌표 쿼리 이름
- 십진 위경도 쌍
- 숫자 두 원소 좌표 배열

별도로 길찾기 화면의 일반 브라우저 주소창 `dir` 쿼리에는 출발지와 목적지 좌표가 들어 있었다. 이는 WebMCP가 반환한 JSON이 아니라 기존 화면 상태 URL이다. 현재 W2의 좌표 비노출 계약은 도구 출력에 적용되므로 이번 판정에서는 실패로 세지 않았다. 주소창까지 개인정보 범위를 넓힐지는 별도 제품 판단이다.

## 8. 검증하지 못한 것

다음은 자동 Chrome 호출로 판정할 수 없다.

- `search_places`에서 `get_place_info`로 이어질 때 VoiceOver 착지가 상세 제목 한 번만 발생하는가
- ChatGPT 호스트 발화가 페이지 완료 통지를 삼키는가
- readOnlyHint가 거짓인 도구 호출 전 호스트 확인 UI가 VoiceOver로 조작 가능한가
- 도구가 없는 AI 채팅, 내 주변, 순수 화면 이동 요청에서 호스트가 DOM 폴백을 선택하는가

`docs/FIELD-TEST.md` §8의 위원장 실기기 절차가 이 네 축의 정본이다. 이번 보고서의 데이터 호출 성공으로 이를 종결하지 않는다.

## 9. 제외한 환경 오류

추가 게이트 검증의 첫 재시도 한 번은 이전 일회성 Chrome 세션이 종료된 뒤 `about:blank`만 남은 상태에서 시작해 도구 0개를 반환했다. 배포 URL을 새 탭으로 다시 열지 않은 하니스 오류였고, 새 페이지를 연 뒤 7개 도구가 다시 발견됐다. 제품 실패 판정에는 포함하지 않았다.

## 10. 최종 판정

W2의 주 사용 사례인 검색, 장소와 역 정보, 세 수단 길찾기 브리핑은 Chrome WebMCP 환경에서 실제로 이어졌다. 출력 상한, 페이지네이션, 좌표 비노출도 배포본에서 확인했다. 그러나 시설 복합 축은 첫 호출마다 내부 쿨다운으로 부분 응답이 되므로, W2 배포 게이트를 완전히 닫을 수 없다. `docs/BACKLOG.md` W2의 열린 결함을 고친 뒤 시설 첫 호출을 재검증하고, VoiceOver와 호스트 음성 게이트는 위원장이 별도로 판정해야 한다.
