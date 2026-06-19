# 내 주변 둘러보기 + 보행 인프라 안내 (Surroundings Awareness) — 설계안

**날짜**: 2026-06-20 · **상태**: 범위 확정(2026-06-20, 사용자 — **기능 A 우선 V1, 기능 B는 후속 마일스톤**) · **게이트**: kakao 키(기존) / Overpass(무키 공개 인스턴스) / data.go.kr 음향신호기(키 보유·데이터셋 확인 필요) · **출처**: 딥리서치(BlindSquare·Microsoft/Scottish-Tech-Army Soundscape·VoiceVista·Overpass `around`) + **Overpass 실호출 검증(이 세션)**

## 0. 배경·동기

BlindSquare·Microsoft Soundscape의 본질은 *턴바이턴 길안내가 아니라 "지금 내 주변에 뭐가 있는지" 상시 인지(ambient awareness)* — 주변 POI를 카테고리별로 자동 호출하고 방향(시계 방향)을 말로 알려준다. gildongmu는 "내 주변" 섹션(지하철·버스·따릉이·소아진료·아이놀곳)과 kids-places의 `classifyKidsPlace`로 이 패턴을 **이미 절반 구현**했다. 이를 일반화한다.

조사 단계에서 "OSM Overpass `around`로 카카오가 비운 **보행 인프라**(횡단보도·점자블록·음향신호기)를 채운다"를 차용 1순위로 봤으나, **실호출 검증으로 가설을 교정**했다(아래 §1). 결론은 단일 소스가 아니라 **3소스 하이브리드**다.

## 1. 실호출 검증 결과 (설계 정본 — 가정 아님)

User-Agent 헤더 필수(누락 시 406). 공개 인스턴스 `overpass-api.de`, rate limit 2슬롯, 응답 수 초.

**보행 인프라 — 길동역(5호선, 37.5378/127.1399) vs 강남역(37.4979/127.0276), 반경 400m**

| 피처 | 길동 | 강남 | 함의 |
|---|---:|---:|---|
| 횡단보도 `highway=crossing` | **15** | 69 | 주거지에도 존재(맨몸 태그, 상세 없음) |
| 점자블록 `tactile_paving=yes` | **5** | 8 | 소수 존재 |
| 신호등 `traffic_signals` | **0** | 7 | 길동 미태깅 |
| **음향신호기 `traffic_signals:sound`** | **0** | 4 | **OSM은 한국 음향신호기 사실상 공백** |
| 보도 `footway`(way) | **0** | 95 | 주거지 보도 미매핑 |
| 계단 `steps` | 0 | 9 | |
| 엘리베이터 `elevator` | 0 | 1 | |
| 출입구 `entrance` | 0 | 0 | 한국 전반 약함 |
| 도로 `sidewalk` 태그 | 0 | — | 보도 우회 태깅도 없음 |

**POI 밀도 — 길동 반경 300m**: `shop` 34건(beauty 19·convenience 12·supermarket 3)·`amenity` 17건. `name:en` 존재하나 자동 음역 품질 낮음("케이씨씨마트"→"Keississi Mart", "연광빌라"가 supermarket로 오분류).

**확정된 사실 4개:**
1. **OSM POI 밀도 ≪ 카카오** (34건 vs 카카오 수백건). → OSM은 POI 정본이 될 수 없다. **주변 둘러보기 POI는 카카오 유지.**
2. **OSM 보행 태깅은 지역 편차 극심** (강남 풍부, 길동 거의 빈약). → "어디서나 보행 안내"를 약속할 수 없다. **빈 곳은 graceful degrade**("등록된 보행 정보 없음" ≠ "안전").
3. **OSM이 길동에서도 주는 차별 레이어 = 횡단보도·점자블록 위치뿐** (카카오엔 없음). 단 맨몸 태그라 가치 제한적.
4. **음향신호기는 OSM 한국 데이터 공백** → **data.go.kr 한국 공식 소스로 피벗**(경찰청 교통신호 계열 데이터 존재 확인, 정확한 데이터셋·필드는 실호출로 확정 — gildongmu가 이미 `DATA_GO_KR_API_KEY` 보유).

## 2. 범위 결정 (증거 기반)

V1을 두 기능으로 나눈다. **A는 견고·범용, B는 best-effort·지역편차 명시.**

- **기능 A — 주변 둘러보기**(카카오, 신규 키 0): 반경 내 상점·시설을 거리+방향으로 호출. kids-places 일반화. **헤드라인 기능.**
- **기능 B — 주변 보행 안내**(하이브리드, best-effort): 횡단보도·점자블록(OSM) + 음향신호기(data.go.kr). 데이터 있는 곳만, 없으면 정직 고지. **보조 레이어로 명확히 포지셔닝**(주거지에선 비어 있을 수 있음).

> 솔직한 트레이드오프(설계에 박음): gildongmu 정체성은 "국내 서비스 연동"인데 OSM은 글로벌 오픈데이터다. OSM은 **카카오 대체가 아니라 카카오가 비운 칸(횡단보도·점자블록)만 채우는 보완재**다. 음향신호기는 OSM이 아니라 **한국 공식 데이터**가 정본 — 데이터 현실이 소스를 결정한다.

## 3. 공통 규칙 (로드맵 머지 게이트 상속)

1. **실호출이 머지 게이트.** fixture green ≠ 실계약. data.go.kr 음향신호기 데이터셋 실호출로 필드명·수록범위 확정. 막히면 "코드 완료"가 아니라 "대기"(기능 B 음향신호기만 보류, A·OSM은 독립 진행).
2. **provider 격리.** `overpass.ts`가 OSM 응답을 자체 shape로 정규화 → 라우트·컴포넌트는 OSM 필드를 모름(이식성).
3. `src/lib/`는 React/Next 비의존(dodo-planet 이식성).
4. 키/데이터 유무 게이트 + graceful 폴백. **mock 폴백 없음**(가짜 실데이터 금지) — 빈 결과는 "정보 없음" 명시.
5. a11y: 정보 정본은 텍스트, 상태 변화는 단일 polite `aria-live`. 과잉 ARIA 금지. 거리/방향은 자기완결 li.
6. **ODbL 준수**: OSM 데이터 표시 화면에 출처표기("© OpenStreetMap 기여자").
7. **좌표 WGS84 통일**(앱 전역 원칙). OSM은 WGS84 native라 변환 불필요(에어코리아 TM 함정과 다름).

## 4. 아키텍처

```
[기능 A 주변 둘러보기]
홈 "내 주변" 6번째 섹션 / 또는 독립 진입
  └ awaitGeolocation() (공유 스토어, 권한 팝업 0)
      └ /api/places/around → 카카오 카테고리 검색(x/y/radius/sort=distance)
          → classifySurrounding(카테고리 화이트리스트, kids-places 패턴)
          → bearingFromTo(내좌표→POI) = 방위각 → "2시 방향 30m"
          → 거리순 상위 N · 자기완결 리스트

[기능 B 주변 보행 안내]  (best-effort, 하이브리드)
  └ /api/walk/nearby
      ├ overpass.ts: Overpass around → 횡단보도·점자블록·계단·엘리베이터
      │    (지역편차 큼, 빈 곳 graceful)
      └ data.go.kr 음향신호기: 좌표 근접 → 음향신호기 위치/방향
           (한국 공식 정본, 실호출로 계약 확정 필요)
      → 합성: 거리+방향, 부분 실패 불변식("조회 실패" ≠ "근처 없음")
```

**파일 (deterministic/latent 분리 — 순수 판정은 fixture 테스트):**

| 파일 | 역할 | 의존 | 테스트 |
|---|---|---|---|
| `src/lib/geo/bearing.ts` | `bearingFromTo`(방위각)·`bearingToClock`(→시계방향)·`haversine` 순수 | 없음 | fixture |
| `src/lib/providers/surroundings.ts` | 카카오 카테고리 검색 정규화·`classifySurrounding` | 카카오 | 분류 fixture |
| `src/lib/providers/overpass.ts` | Overpass QL 빌더·응답 정규화·부분실패 | fetch | 정규화 fixture |
| `src/lib/providers/sound-signal.ts` | data.go.kr 음향신호기 정규화 | fetch | 실호출 후 fixture |
| `src/app/api/places/around/route.ts` | 기능 A 라우트 | | |
| `src/app/api/walk/nearby/route.ts` | 기능 B 라우트(OSM+음향 합성) | | |
| `SurroundingsNearby.tsx`·`WalkInfoNearby.tsx` | UI(기존 nearby 동형) | | |

## 5. 솔직한 한계 (설계 전제)

1. **OSM 보행 데이터는 주거지에서 비어 있을 수 있다** — 길동 실측이 증거. 기능 B는 "있으면 보강", 없으면 "현재 위치 주변에 등록된 보행 정보가 없습니다" 정직 고지. **"정보 없음"을 "장애물 없음/안전"으로 오해석시키지 않는다**(B1·B2 unknown 교훈 동형).
2. **횡단보도 맨몸 태그** — `crossing=traffic_signals/uncontrolled`, `crossing_ref=zebra` 등 상세는 길동에서 대부분 누락. 위치만 제공, 신호유무 단정 금지.
3. **Overpass 공개 인스턴스 = 2슬롯·수초 지연·SLA 없음.** 사용자 액션마다 실시간 호출은 위험 → **캐시 `revalidate` 적용**(보행 인프라는 준정적, 분 단위 변동 없음). 프로덕션 부하 크면 self-host/상용 Overpass 또는 주기 스냅샷 검토(별도 마일스톤).
4. **방위(bearing)는 두 좌표 간 방위각** — 사용자가 바라보는 방향(heading) 아님. "북 기준 2시 방향"이지 "당신 정면 2시"가 아님을 고지(distance-beacon의 heading 한계와 동일 선상).
5. **카카오 `name:en` 자동음역 품질 낮음** — en 로케일 영문 표기는 카카오 영문 우선, 없으면 한글 `lang="ko"`(기존 데이터-로케일 분리 원칙).

## 6. 측정 가능한 성과

- **기능 A**: 사용자가 "주변 둘러보기"를 켜면, 화면 없이도 반경 내 상점/시설을 **거리·방향과 함께** 듣고("편의점 GS25, 2시 방향 40m") 어디로 갈지 판단할 수 있다.
- **기능 B**: 음향신호기·점자블록이 등록된 위치에서, 사용자가 횡단 전 "전방 약 30m에 음향신호기 있는 횡단보도"를 확인한다. 미등록 지역에선 그 사실을 정직히 안다(거짓 안심 0).

## 7. 구현 순서 (독립 트랙)

1. **`bearing.ts` + 기능 A** (카카오, 무키, kids-places 복제) — 가장 견고, 먼저.
2. **기능 B-OSM** (`overpass.ts`, 횡단보도·점자블록) — best-effort, ODbL 표기.
3. **기능 B-음향신호기** (data.go.kr) — **실호출로 데이터셋 확정 후** 합성. 미확정이면 B-OSM만 먼저 머지.

## 8. 결정·미결

- **[확정 2026-06-20]** V1 = **기능 A 단독**(주변 둘러보기, 카카오). 기능 B(OSM 횡단보도·점자블록 + data.go.kr 음향신호기)는 **후속 마일스톤** — 길동 OSM 희박성 실측 근거. §4·§7의 B 트랙은 후속 참조로 보존.
- **[미결]** 음향신호기 정확한 data.go.kr 데이터셋 — 경찰청 계열로 추정, 후속 마일스톤 착수 시 실호출 검증.
- **[미결]** 기능 A 진입점: 홈 "내 주변" 6번째 섹션 vs 독립 화면. (구현 착수 시 결정 — 기존 nearby 5종과 동형이면 6번째 섹션이 자연스러움.)
