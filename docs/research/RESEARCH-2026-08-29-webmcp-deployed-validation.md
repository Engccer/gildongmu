# WebMCP W2 배포본 실호출 검증 보고서 (2026-08-29)

> 시점 고정 실측 기록. 대상은 2026-08-29 KST에 배포돼 있던 `https://gildongmu.dodoplanet.space/ko`다. 현재 설계 정본은 `docs/superpowers/specs/2026-08-29-webmcp-wave2-design.md`, 열린 작업은 `docs/BACKLOG.md` W2를 따른다.

## 0. 판정 요약

**부분 통과.** 이동 계획 보조 7개 도구의 발견, 상시 등록, 화면 자가 이동, 불투명 `ref` 연쇄, `planId`와 `routeKey` 연쇄, 1,500자 출력 상한, 좌표 비노출, 단일 축 페이지네이션 기계는 배포본에서 동작했다. 다만 `get_place_info({axes:["facilities"]})`의 첫 호출은 코레일 시설과 도시철도 시설이 같은 60초 예산 버킷을 순차 소비하여 도시철도 쪽을 항상 `cooldown`으로 만든다. 약 60초 뒤 같은 문서에서 재호출하면 회복되지만, 한 축 요청이 한 호출로 완결된다는 계약은 통과하지 못했다. 또한 게이트 ⑩의 판정 대상인 **에이전트의 자율 회수**와 W2가 새로 만든 거절 경로 4종(`busy`·`superseded`·`modalOpen`·`staleResult`)은 이번 호출로 밟지 못했다(§8).

| 축 | 판정 | 근거 |
|---|---|---|
| 도구 7개 발견 | 통과 | 설계 정본과 이름 집합 일치 |
| 화면 전환 뒤 상시 등록 | 통과 | 홈, 장소 상세, 길찾기에서 매번 7개 유지 |
| 검색에서 장소 정보 연쇄 | 통과 | `search_places`의 `ref`를 `get_place_info`가 해석 |
| 검색에서 길찾기 연쇄 | 통과 | 같은 `ref`를 `plan_directions.toRef`로 사용 |
| 경로 상세 연쇄 | 통과 | `planId`와 `routeKey`로 대중교통 상세, `planId`로 도보 단계 조회 |
| 1,500자 상한과 페이지네이션 **기계** | 통과 | 서울역 시설 7개 그룹을 `offset:0`, `offset:6` 두 페이지로 회수, 최대 1,483자 |
| 게이트 ⑩ 에이전트 자율 회수 | 미확인 | `offset`을 검사자가 지정했고, 시설 첫 호출은 324자라 `truncated`가 뜨는 상황이 아니었다 |
| WebMCP 출력 좌표 비노출 | 통과 | 좌표 키, 쿼리 이름, 십진 좌표쌍 없음 |
| 시설 축 첫 호출 완결 | 실패 | 도시철도 시설이 3회 모두 약 60초 `cooldown` |
| 거절 경로(`busy`·`superseded`·`modalOpen`·`staleResult`) | 미확인 | 실패 경로는 `needsDisambiguation` 하나만 밟았다 |
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

`open_directions`, `focus_item`, 안내 도구 3개, 보행 인프라 도구는 없었다. W2에서 삭제한 집합과 일치한다. 홈에서 검색한 뒤 장소 상세와 길찾기로 이동할 때마다 도구 목록을 다시 읽었고, 추가 등록이나 철회 없이 같은 7개가 유지됐다.

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

축 하나와 `offset:0`을 명시하여 페이지 모드로 다시 직렬화했다. **`offset`은 에이전트가 아니라 검사자가 지정했다.**

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

### 4.3 이것으로 게이트 ⑩이 닫히지는 않는다

게이트 ⑩의 문언은 "`truncated` 뒤 **에이전트가** 단일 축 + `offset`으로 전량을 받는가"이고, 판정 대상은 출력 상한 기계가 아니라 **잘림을 본 에이전트의 자율 회수 행동**이다. 이번 관측은 두 가지 이유로 그 판정을 대신하지 못한다.

- `offset`을 검사자가 직접 지정했다. 에이전트가 스스로 페이징으로 전환하는지는 관측하지 않았다.
- 시설 첫 호출은 쿨다운 결함 때문에 324자였으므로 **잘림 자체가 일어나지 않았다.** 출력에는 `truncated:true` 필드가 있는데(`src/lib/webmcp/output.ts`), 이번 검증에서 그 값을 관측한 기록이 없다.

따라서 이 절의 판정은 "출력 상한과 페이지네이션 기계가 유한하게 동작한다"까지다. 게이트 ⑩ 자체는 §8로 넘긴다. 시설 결함을 고치면 서울역 시설 축 전체가 1,500자를 넘겨 `truncated`가 실제로 발생하므로, 그때가 이 게이트의 첫 관측 기회다.

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
- **`axes`를 생략한 역 조회에도 같은 충돌이 난다.** 축을 안 고르면 역은 5축 전부를 도는데 그 안에 `facilities`가 들어 있다. "강동역 정보 알려 줘"처럼 축을 지정하지 않는 호출이 오히려 더 흔하므로, 영향은 시설을 콕 집어 물은 경우로 한정되지 않는다.
- 긴 시설 역의 1,500자 페이지네이션 자체는 동작하지만, 그 앞에 불필요한 60초 대기가 붙는다.

### 5.4 수정 완료 조건

**먼저 정할 것 — 예산 버킷을 어떻게 셀 것인가.** 두 안이 경쟁하며 외부 서비스 사용량 계산이 달라진다.

- **ⓐ 한 번만 소비**: 축 단위로 `checkBudget`·`consumeBudget`을 한 번 하고 두 키를 모두 실행한다. 에이전트가 보는 쿨다운 의미("한 논리적 호출 = 한 소비")가 단순하다. 다만 코레일과 도시철도는 **서로 다른 외부 서비스**이므로, 시간당 30회 상한 아래에서 실제 외부 호출은 60회가 된다.
- **ⓑ 버킷 분리**: `facilitiesMetro`에 자기 버킷을 준다(`bucketOf`에서 갈라 각자 60초). 두 upstream의 사용량이 정직하게 세어지고 충돌이 구조적으로 사라진다. 대신 버킷이 하나 늘고, 한 축 안에서 두 소스의 쿨다운이 따로 돌 수 있다(한쪽만 `cooldown`인 `partial`이 여전히 가능하다 — 다만 그때는 실제로 그 소스만 최근에 조회된 경우다).

어느 쪽이든 아래를 만족해야 한다.

1. 새 문서의 첫 `get_place_info({axes:["facilities"]})`에서 Korail과 도시철도 내부 소스가 모두 실행된다. `axes` 생략(역 5축 전부) 경로도 같다.
2. 예산 소비 방식이 위 ⓐ·ⓑ 중 하나로 **명시적으로** 정해지고 그 근거가 코드 주석에 남는다.
3. (이미 참 — 회귀 방지용) 같은 축의 정착 데이터를 `offset`으로 재직렬화할 때는 예산을 소비하지 않는다. 현재도 `runKey`의 `needsFetch` 가드가 이를 보장하므로 새로 고칠 것은 없고, 수정 과정에서 깨지지 않았는지만 확인한다.
4. 첫 호출 직후 새 `refresh:true` 요청처럼 실제 추가 fetch를 요구하는 별도 호출은 기존 60초 쿨다운을 지킨다.
5. 두 내부 소스가 모두 `idle`인 회귀 테스트를 추가하여, 두 `ensureLoaded`가 실행되고 둘째가 내부 `cooldown`이 되지 않음을 단언한다. 기존 복합 시설 테스트는 두 소스를 미리 `done`·`empty`로 게시하므로 이 경로를 밟지 않는다(§6).
6. 배포본 서울역 1호선에서 첫 호출 `facilities.status:"done"`, 페이지 `offset:0`과 후속 offset 전량 회수를 다시 확인한다. 이때 **`truncated:true`가 실제로 관측되는지**도 함께 기록한다(게이트 ⑩의 첫 관측 기회, §4.3).

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

별도로 길찾기 화면의 일반 브라우저 주소창 `dir` 쿼리에는 이번 시험의 출발지·도착지 좌표가 들어 있었다. 이는 WebMCP가 반환한 JSON이 아니라 기존 화면 상태 URL이고, W2의 좌표 비노출 계약은 도구 출력에 적용되므로 실패로 세지 않는다.

**다만 이 관측을 "사용자 위치가 URL에 남는다"로 읽으면 안 된다.** `src/lib/directions-state.ts`에 명시적 계약이 있다 — **현재 위치는 좌표 없이 `cur` 토큰으로만 직렬화된다**(복원 시 재측위가 정본). 좌표가 실리는 것은 이름 있는 장소 토큰(`라벨@lat,lng`)뿐이고, 그 좌표는 애초에 검색 결과로 공개된 장소의 좌표다. 이번 시험은 길동역 → 강동역이라 양쪽 모두 이름 있는 장소였고, 그래서 두 좌표가 다 보인 것이다.

따라서 사용자 자기 위치는 이 경로로 새지 않으며, 열어 둘 제품 판단이 아니다. `cur` 계약이 유지되는 한 이 항목은 닫힌다. 재확인이 필요하다면 판정 술어는 "주소창에 좌표가 있는가"가 아니라 **"출발지가 현재 위치일 때 `dir=cur/…`인가"**다.

## 8. 검증하지 못한 것

### 8.1 실기기에서만 갈리는 것 (자동 Chrome 호출로 판정 불가)

- `search_places`에서 `get_place_info`로 이어질 때 VoiceOver 착지가 상세 제목 한 번만 발생하는가 (게이트 ⑧)
- ChatGPT 호스트 발화가 페이지 완료 통지를 삼키는가 (게이트 ⑨)
- readOnlyHint가 거짓인 도구 호출 전 호스트 확인 UI가 VoiceOver로 조작 가능한가
- 도구가 없는 AI 채팅, 내 주변, 순수 화면 이동 요청에서 호스트가 DOM 폴백을 선택하는가 (게이트 ⑦)

`docs/FIELD-TEST.md` §8의 위원장 실기기 절차가 이 네 축의 정본이다. 이번 보고서의 데이터 호출 성공으로 이를 종결하지 않는다.

### 8.2 밟을 수 있었으나 이번에 밟지 않은 것

아래는 실기기 전용이 아니라 **같은 Chrome 자동화로 관측 가능한데 이번 검증 범위에 없었다.** W2가 새로 만든 기계 중 위험이 큰 쪽이 여기 몰려 있으므로, 통과로 세지 않는다.

- **게이트 ⑩의 에이전트 자율 회수**: `truncated`를 본 에이전트가 스스로 단일 축 + `offset`으로 전환하는가(§4.3). 이번엔 검사자가 `offset`을 지정했고 `truncated`는 발생조차 하지 않았다.
- **`busy`(단일 실행 잠금)**: 앞 도구가 도는 중 다른 도구를 부르면 `busy{running}`으로 즉시 거절하는가.
- **`superseded`(사용자 조작 우선)**: 도구가 조회를 기다리는 사이 화면에서 새 검색·새 조회를 일으키면 앞 세대 대기자가 `superseded`로 끝나는가.
- **`modalOpen`**: 채팅 오버레이나 현재 위치 지정 모달이 열린 상태에서 도구를 부르면 모달을 닫지 않고 거절하는가.
- **`staleResult` 복구**: 검색을 다시 한 뒤 앞 세대 `ref`를 쓰면 `staleResult` + `recovery:"search_places"` + `query`가 오고, 에이전트가 그 안내대로 재검색해 잇는가.

이 다섯은 실패 경로라 정상 흐름 검증으로는 한 번도 지나가지 않는다. 다음 재검증(시설 결함 수정 뒤)에서 함께 밟는다.

## 9. 제외한 환경 오류

추가 게이트 검증의 첫 재시도 한 번은 이전 일회성 Chrome 세션이 종료된 뒤 `about:blank`만 남은 상태에서 시작해 도구 0개를 반환했다. 배포 URL을 새 탭으로 다시 열지 않은 하니스 오류였고, 새 페이지를 연 뒤 7개 도구가 다시 발견됐다. 제품 실패 판정에는 포함하지 않았다.

## 10. 최종 판정

W2의 주 사용 사례인 검색, 장소와 역 정보, 세 수단 길찾기 브리핑은 Chrome WebMCP 환경에서 실제로 이어졌다. 출력 상한과 페이지네이션 기계, 좌표 비노출도 배포본에서 확인했다. 그러나 시설 복합 축은 첫 호출마다 내부 쿨다운으로 부분 응답이 되므로, W2 배포 게이트를 완전히 닫을 수 없다.

남은 순서는 셋이다. ①`docs/BACKLOG.md` W2-B1의 열린 결함을 고치고 시설 첫 호출을 재검증한다(예산 버킷을 어떻게 셀지는 §5.4의 ⓐ·ⓑ 판정이 선행한다). ②같은 재검증에서 §8.2의 다섯 축(게이트 ⑩ 자율 회수와 거절 경로 4종)을 함께 밟는다. ③VoiceOver와 호스트 음성 게이트(⑧·⑨)는 위원장이 실기기에서 별도로 판정한다. **이번 보고서로 닫히는 게이트는 없다.**


## 11. 재검증 (2026-08-30 05:00~05:20 KST, 배포 `15ecb19` 이후)

W2-B1 수정(시설 예산 버킷을 코레일·도시철도 upstream별로 분리, ⓑ 채택)을 배포한 뒤 같은 Chrome DevTools MCP 표면으로 §0의 실패·미확인 축을 다시 밟았다. 새 문서, 첫 호출 조건이다.

| 축 | 판정 | 관측 |
|---|---|---|
| 시설 축 첫 호출 완결 | **통과** | 서울역 `get_place_info({axes:["facilities"]})` 첫 호출이 `korail done`·`metro done`, 결합 `done`. `cooldown` 없음 |
| 게이트 ⑩ `truncated` 관측 + 자율 회수 | **통과(에이전트=Claude)** | 첫 호출에 `truncated:true`(`groupsReturnedCount 3 / groupsTotalCount 7`). 도구 설명("If truncated, call again with one axis and offset")만 보고 `offset:3`(→`nextOffset:6`), `offset:6`으로 7개 그룹 전량 회수, 마지막 페이지에 `truncated` 없음. 재직렬화 페이지는 즉시 반환(예산 미소비). ⚠ ChatGPT 호스트가 같은 회수를 하는가는 위원장 실기기 항목으로 남는다 |
| `busy` | **통과** | 페이지 안에서 `navigator.modelContext.executeTool` 두 개를 동시 실행: `plan_directions`가 돌고 `search_places`가 `busy{running:"plan_directions"}` |
| `staleResult` 복구 | **통과** | 검색 세대 2 발급 뒤 세대 1 `ref`(`sg6c2.1.p.0`)로 `get_place_info` → `staleResult{retryable:true, recovery:"search_places", query:"강동역"}` |
| `modalOpen` | **통과** | "AI에게 질문" 오버레이를 연 채 `get_place_info` → `modalOpen{retryable:false, userActionRequired:true}`, 모달은 닫히지 않음(`read_current_view.chatOpen:true`, 잠금 없이 응답) |
| `superseded` | **UI 경로로 도달 불가(결함 아님)** | 도구 검색이 진행 중일 때 사용자가 검색창 Enter·조회 버튼·계단 회피 토글로 새 조회를 일으키려 하면 **화면의 in-flight 가드**(`runSearch`의 `status.kind === "loading"` 조기 반환, `DirectionsView`의 `aria-disabled={busy}`)가 그 조작을 떨어뜨린다 — 사용자 자신의 더블 제출을 막는 것과 같은 가드다. 최근 검색어 목록은 로딩 중엔 렌더되지 않고, 검색은 `replaceState`라 뒤로가기도 새 세대를 만들지 않는다(`history.back()` 실측: 앱 밖 `about:blank`로 이탈). 따라서 `superseded`는 음성 전사·`?q=` 복원처럼 가드 없는 경로에서만 성립하며 단위 테스트(`search-places.test.ts`·`PlaceSearchWebMcp.test.tsx`)로만 검증된 상태다. 사용자가 막히는 창은 도구 조회의 in-flight 몇 초뿐이라 "사용자 조작이 도구를 이긴다"와 충돌하지 않는다 |

부수 발견: 서울역 도시철도 시설의 "교통약자 도우미 2곳" 그룹이 빈 문자열 줄 두 개를 실었다(upstream이 수만 주고 `fcltNm`이 빈다). 화면도 같은 함수(`metroFacilityGroups`)라 빈 `<li>`가 있었다 — 빈 줄을 떨어뜨리도록 고쳤다(헤딩의 수는 유지). 같은 날 배포.

남는 것은 실기기 전용 §8.1 네 축(⑦·⑧·⑨·호스트 확인 UI)뿐이다.
