# gildongmu-mcp

대한민국 길찾기·로컬 정보를 [Model Context Protocol](https://modelcontextprotocol.io)로 노출하는 stdio 서버. Claude Code, Cursor, Codex, Cline 등 MCP 호환 코딩 에이전트에서 자연어로 호출 가능. 공개 REST API를 그대로 중계하는 씬 서버라 자체 비즈니스 로직이 없다.

## 설치

인증이 필요 없다. 계정·토큰 없이 바로 등록한다.

### Claude Code

```bash
claude mcp add gildongmu -- npx -y gildongmu-mcp
```

### Cursor / Cline

`mcpServers` 설정에 추가:

```json
{
  "mcpServers": {
    "gildongmu": {
      "command": "npx",
      "args": ["-y", "gildongmu-mcp"]
    }
  }
}
```

### Codex

```bash
codex mcp add gildongmu -- npx -y gildongmu-mcp
```

## 환경변수

- `GILDONGMU_API_URL`: API 엔드포인트(기본 `https://gildongmu.dodoplanet.space`)

## 노출되는 도구 (27종)

전부 읽기 전용(`readOnlyHint: true`). 도구명은 REST 카탈로그 이름을 스네이크 케이스로 바꾼 것이다(예: `nearby-subway` → `nearby_subway`).

| 도구 | 설명 |
|---|---|
| `places_search` | 장소 검색(카카오 로컬, 좌표 있으면 근접 블렌딩 정확도순) |
| `address_search` | 도로명·지번 주소와 우편번호 검색(juso) |
| `geocode` | 장소·주소 문자열을 WGS84 좌표로 변환 |
| `nearby_subway` | 내 주변 지하철역 실시간 도착 |
| `nearby_bus` | 내 주변 버스 정류소 실시간 도착 |
| `nearby_bike` | 내 주변 따릉이 대여소(서울) |
| `nearby_clinic` | 내 주변 소아 야간·휴일 진료 |
| `nearby_kids` | 내 주변 아이 놀 곳 |
| `nearby_around` | 내 주변 둘러보기(편의점·카페 등 10종+8방위) |
| `nearby_events` | 내 주변 오늘 진행 중인 문화행사(서울) |
| `nearby_barrier_free` | 내 주변 무장애 관광지 |
| `nearby_walk_infra` | 내 주변 보행 인프라(음향신호기·횡단보도·점자블록) |
| `nearby_congestion` | 지금 있는 곳의 실시간 인구 혼잡도(서울 주요 지점 116곳 한정) |
| `station_meta` | 도시철도역 메타(영문명·노선·환승) |
| `station_facilities` | 철도역 교통약자 시설(코레일) |
| `station_metro_facilities` | 서울 지하철역 교통약자 시설 |
| `station_timetable` | 역 첫차·막차 시간표 |
| `subway_arrival` | 지하철역 실시간 도착(역명) |
| `bus_route_stops` | 버스 노선 경유 정류소 |
| `route_car` | 자동차 경로 텍스트 브리핑(턴바이턴) |
| `route_transit` | 대중교통 경로(추천+대안, ODsay) |
| `route_walk` | 도보 경로 텍스트 브리핑(기본 카카오·폴백 Tmap, `accessible`로 계단 회피) |
| `weather` | 이 지역 날씨(기상청 실황+예보) |
| `air_quality` | 이 지역 공기질(에어코리아) |
| `where_am_i` | 현재 위치 정위(주소·행정동·가까운 역·기준점) |
| `barrier_free_detail` | 무장애 관광지 편의시설 상세 |

채팅(`chat`)·웹 검색(`web`)은 호스트 LLM이 직접 처리하는 몫이라 MCP 도구로는 노출하지 않는다.

`places_search`·`route_car`·`route_walk`·`route_transit`·`station_meta`·`station_timetable`·
`subway_arrival`·`nearby_subway`은 선택 입력 `lang`을 받는다. `en`이면 서버가 영문 안내 문장과
`*En` 필드(`lineNameEn`·`messageEn` 등)를 함께 싣는다 — 한국어 필드는 조인 키라 그대로 남는다.

## 동작 방식

```
[Claude Code/Cursor/Codex]
        ↓ MCP stdio
[gildongmu-mcp]
        ↓ HTTPS GET
[https://gildongmu.dodoplanet.space/api/*]
```

CLI(`gildongmu`)와 동일한 REST API·엔드포인트 카탈로그를 공유한다. 서버 전용 시크릿(카카오·데이터포털·기상청 등 API 키)은 프로덕션 서버에만 존재하며 사용자 머신으로 새지 않는다.
