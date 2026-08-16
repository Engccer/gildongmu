import { describe, it, expect } from "vitest";
import { FORMATTERS } from "../lib/formatters.js";

// ── 브리프 필수 3-state 케이스 ──────────────────────────────────────────

describe("nearby-subway 4-state", () => {
  // text 모드에서만 드러나는 축이라 테스트로 고정한다 — 파이프 실호출은 비-TTY라
  // JSON으로 빠져 이 분기를 통과하지 못한다([[cli-formatter-registration-gap]]).
  it("closed는 첫차를 안내하고, 첫차가 없으면 미제공으로 물러선다", () => {
    const lines = FORMATTERS["nearby-subway"]({
      stations: [
        {
          stationName: "천호", lines: ["5호선", "8호선"], distanceMeters: 14,
          arrivalStatus: "closed", arrivals: [], firstTime: "05:32",
        },
        {
          stationName: "강동구청", lines: ["8호선"], distanceMeters: 943,
          arrivalStatus: "closed", arrivals: [],
        },
      ],
    } as never);
    expect(lines[1]).toBe("  운행 시간이 아님. 첫차 05:32.");
    expect(lines[3]).toBe("  실시간 도착 정보 미제공.");
  });

  it("unknown은 '역 없음'이 아니라 미제공으로 표기(역은 목록에 남는다)", () => {
    const lines = FORMATTERS["nearby-subway"]({
      stations: [
        {
          stationName: "김포공항", lines: ["김포골드라인"], distanceMeters: 300,
          arrivalStatus: "unknown", arrivals: [],
        },
      ],
    } as never);
    expect(lines[0]).toBe("김포공항역, 김포골드라인, 300m");
    expect(lines[1]).toBe("  실시간 도착 정보 미제공.");
  });

  it("unavailable은 '조회 실패', 빈 arrivals는 '없음'으로 구분", () => {
    const lines = FORMATTERS["nearby-subway"]({
      stations: [
        { stationName: "길동", lines: ["5호선"], distanceMeters: 220, arrivalStatus: "unavailable", arrivals: [] },
        { stationName: "강동", lines: ["5호선"], distanceMeters: 480, arrivalStatus: "ok", arrivals: [] },
      ],
    } as never);
    expect(lines.join("\n")).toContain("실시간 도착 조회 실패");
    expect(lines.join("\n")).toContain("도착 예정 열차 없음");
  });

  it("도착 열차가 있으면 노선·행선·메시지·급행 표기", () => {
    const lines = FORMATTERS["nearby-subway"]({
      stations: [
        {
          stationName: "천호",
          lines: ["5호선", "8호선"],
          distanceMeters: 130,
          arrivalStatus: "ok",
          arrivals: [{ line: "5호선", trainLineNm: "방화행 - 김포공항방면", message: "3분 후", express: false }],
        },
      ],
    } as never);
    expect(lines[0]).toBe("천호역, 5호선·8호선, 130m");
    expect(lines[1]).toBe("  5호선, 방화행 - 김포공항방면, 3분 후");
  });
});

describe("station-facilities unknown 생략", () => {
  it("undefined 시설은 문장에서 생략(0대와 구분)", () => {
    const lines = FORMATTERS["station-facilities"]({
      facilities: {
        stationName: "서울역", accessibleToilet: true, wheelchairLifts: undefined, accessibleSlope: false, elevators: 0,
      },
    } as never);
    const text = lines.join("\n");
    expect(text).toContain("엘리베이터 0대"); // 0은 표기
    expect(text).not.toContain("휠체어 리프트"); // unknown은 생략
  });

  it("역 자체가 미커버(null)면 '시설 정보 없음'", () => {
    expect(FORMATTERS["station-facilities"]({ facilities: null } as never)).toEqual(["시설 정보 없음."]);
  });

  it("전부 생략되면 '시설 정보 없음'", () => {
    const lines = FORMATTERS["station-facilities"]({
      facilities: { stationName: "미커버역", accessibleToilet: false, wheelchairLifts: undefined, accessibleSlope: false, elevators: undefined },
    } as never);
    expect(lines).toEqual(["시설 정보 없음."]);
  });
});

describe("빈 목록", () => {
  it("0건은 '없습니다' 한 줄", () => {
    expect(FORMATTERS["nearby-bike"]({ stations: [] } as never)).toEqual(["주변에 따릉이 대여소가 없습니다."]);
  });
});

// ── 도메인별 최소 1 fixture ─────────────────────────────────────────────

describe("places-search", () => {
  it("한 줄=한 항목, 도로명 우선·전화·거리 포함", () => {
    const lines = FORMATTERS["places-search"]({
      places: [
        {
          name: "강동맛집", category: "음식점>한식", address: "서울 강동구 길동 1",
          roadAddress: "서울 강동구 천호대로 100", phone: "02-000-0000", distanceMeters: 120,
        },
      ],
    } as never);
    expect(lines).toEqual(["강동맛집, 음식점>한식, 서울 강동구 천호대로 100, 02-000-0000, 120m"]);
  });

  it("0건이면 검색 결과 없음 한 줄", () => {
    expect(FORMATTERS["places-search"]({ places: [] } as never)).toEqual(["검색 결과가 없습니다."]);
  });
});

describe("address-search", () => {
  it("도로명+지번+우편번호+영문주소", () => {
    const lines = FORMATTERS["address-search"]({
      addresses: [{ roadAddr: "서울특별시 중구 세종대로 110", jibunAddr: "태평로1가 31", zipNo: "04524", engAddr: "110 Sejong-daero, Jung-gu, Seoul" }],
    } as never);
    expect(lines).toEqual(["서울특별시 중구 세종대로 110, 지번 태평로1가 31, 우편번호 04524, 110 Sejong-daero, Jung-gu, Seoul"]);
  });

  it("0건이면 검색 결과 없음", () => {
    expect(FORMATTERS["address-search"]({ addresses: [] } as never)).toEqual(["검색 결과가 없습니다."]);
  });
});

describe("nearby-kids", () => {
  it("kind 라벨 + 실내/실외(unknown은 생략)", () => {
    const lines = FORMATTERS["nearby-kids"]({
      kids: [
        { name: "OO키즈카페", category: "매장 > 키즈카페", address: "서울 강동구", roadAddress: "서울 강동구 A", phone: "02-1", distanceMeters: 250, kind: "kidscafe", indoorOutdoor: "indoor" },
        { name: "OO어린이공원", category: "공원", address: "서울 강동구", distanceMeters: 800, kind: "park", indoorOutdoor: "unknown" },
      ],
    } as never);
    expect(lines[0]).toBe("OO키즈카페, 매장 > 키즈카페, 서울 강동구 A, 02-1, 250m, 키즈카페, 실내");
    expect(lines[1]).toBe("OO어린이공원, 공원, 서울 강동구, 800m, 어린이공원");
    expect(lines[1]).not.toContain("실외");
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["nearby-kids"]({ kids: [] } as never)).toEqual(["주변에 아이 놀 곳이 없습니다."]);
  });
});

describe("nearby-bus", () => {
  it("정류소 줄 + 도착 줄(들여쓰기), unavailable 구분", () => {
    const lines = FORMATTERS["nearby-bus"]({
      stops: [
        {
          name: "강동구청앞", stopNo: "12345", distanceMeters: 80, arrivalStatus: "ok",
          arrivals: [
            { routeNo: "302", routeType: "간선버스", arrivalSeconds: 180, prevStationCount: 2, lowFloor: true },
            { routeNo: "371", routeType: "지선버스", arrivalSeconds: 0, prevStationCount: 0, lowFloor: false, arrivalMessage: "운행종료" },
          ],
        },
        { name: "길동사거리", distanceMeters: 200, arrivalStatus: "unavailable", arrivals: [] },
      ],
    } as never);
    expect(lines[0]).toBe("강동구청앞, 12345번, 80m");
    expect(lines[1]).toBe("  302, 간선버스, 3분 후, 2정류장 전, 저상");
    expect(lines[2]).toBe("  371, 지선버스, 운행종료");
    expect(lines[3]).toBe("길동사거리, 200m");
    expect(lines[4]).toContain("실시간 도착 조회 실패");
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["nearby-bus"]({ stops: [] } as never)).toEqual(["주변에 버스 정류소가 없습니다."]);
  });
});

describe("nearby-bike", () => {
  it("자전거·거치대·거리", () => {
    const lines = FORMATTERS["nearby-bike"]({
      stations: [{ name: "3681. 길동 마루빌딩", distanceMeters: 90, racksTotal: 10, bikesAvailable: 4 }],
    } as never);
    expect(lines).toEqual(["3681. 길동 마루빌딩, 자전거 4대, 거치대 10대, 90m"]);
  });
});

describe("nearby-clinic", () => {
  it("진료중/진료 종료 표기, unknown은 생략", () => {
    const lines = FORMATTERS["nearby-clinic"]({
      clinics: [
        { name: "OO소아과", kind: "의원", phone: "02-1234-5678", address: "서울 강동구 A", distanceMeters: 400, openStatus: { state: "open" } },
        { name: "XX병원", kind: "병원", phone: "", address: "서울 강동구 B", distanceMeters: 600, openStatus: { state: "unknown" } },
      ],
    } as never);
    expect(lines[0]).toBe("OO소아과, 의원, 진료중, 02-1234-5678, 서울 강동구 A, 400m");
    expect(lines[1]).toBe("XX병원, 병원, 서울 강동구 B, 600m");
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["nearby-clinic"]({ clinics: [] } as never)).toEqual(["주변에 소아 야간·휴일 진료 기관이 없습니다."]);
  });
});

describe("nearby-around", () => {
  it("categoryRaw 마지막 조각 + 8방위 한글", () => {
    const lines = FORMATTERS["nearby-around"]({
      places: [{ name: "강동구청", categoryRaw: "공공기관 > 주민센터", distanceMeters: 150, bearing: "n" }],
    } as never);
    expect(lines).toEqual(["강동구청, 주민센터, 150m 북"]);
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["nearby-around"]({ places: [] } as never)).toEqual(["주변 정보가 없습니다."]);
  });
});

describe("nearby-barrier-free", () => {
  it("항목 줄 + 상세 안내 줄", () => {
    const lines = FORMATTERS["nearby-barrier-free"]({
      places: [{ contentId: "12345", name: "경복궁", category: "고궁", address: "서울 종로구 세종로", distanceMeters: 500 }],
    } as never);
    expect(lines).toEqual(["경복궁, 고궁, 서울 종로구 세종로, 500m", "상세: gil place barrier-free 12345"]);
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["nearby-barrier-free"]({ places: [] } as never)).toEqual(["주변에 무장애 관광지가 없습니다."]);
  });
});

describe("nearby-walk-infra", () => {
  it("両소스 ok: 그룹별 수치·항목 한 줄·등록 기준 각주와 両출처를 낭독한다", () => {
    const lines = FORMATTERS["nearby-walk-infra"]({
      walk: {
        audioSignals: {
          status: "ok",
          data: {
            deviceCount: 3,
            sites: [
              { distanceMeters: 45, bearing: "ne", deviceCount: 2 },
              { distanceMeters: 120, bearing: "s", deviceCount: 1 },
            ],
            baseDate: "2026-05-01",
          },
        },
        osm: {
          status: "ok",
          data: {
            features: [
              { crossing: true, crossingSignal: "yes", tactilePaving: true, distanceMeters: 30, bearing: "n" },
              { crossing: false, crossingSignal: "unknown", tactilePaving: true, hostFeature: "busStop", distanceMeters: 60, bearing: "e" },
            ],
            crossingTotal: 12,
            tactileTotal: 1,
          },
        },
      },
    } as never);
    expect(lines[0]).toBe("음향신호기 반경 300m 안 3기");
    expect(lines[1]).toBe("  북동 45m(2기)");
    expect(lines[2]).toBe("  남 120m(1기)");
    expect(lines[3]).toBe("횡단보도 12곳 중 가까운 1곳");
    expect(lines[4]).toBe("  북 30m, 신호등 있음, 점자블록 있음");
    expect(lines[5]).toBe("점자블록 1곳");
    expect(lines[6]).toBe("  동 60m, 버스정류장");
    expect(lines[7]).toBe("서울시·OSM 등록 자료 기준으로, 실제 시설 유무나 작동 상태와 다를 수 있습니다.");
    expect(lines[8]).toBe("© OpenStreetMap 기여자, 음향신호기: 서울특별시 제공(2026-05-01 기준)");
  });

  it("0건은 '등록 없음' 문장으로(unsupported·error와 다른 문장, 3-state)", () => {
    const lines = FORMATTERS["nearby-walk-infra"]({
      walk: {
        audioSignals: { status: "ok", data: { deviceCount: 0, sites: [], baseDate: "2026-05-01" } },
        osm: { status: "ok", data: { features: [], crossingTotal: 0, tactileTotal: 0 } },
      },
    } as never);
    expect(lines).toEqual([
      "반경 300m 안에 등록된 음향신호기가 없습니다.",
      "주변에 등록된 횡단보도가 없습니다.",
      "주변에 등록된 점자블록이 없습니다.",
      "서울시·OSM 등록 자료 기준으로, 실제 시설 유무나 작동 상태와 다를 수 있습니다.",
      "© OpenStreetMap 기여자, 음향신호기: 서울특별시 제공(2026-05-01 기준)",
    ]);
  });

  it("unsupported(서울 외)는 미제공 문장, 성공한 osm 출처만 인용한다", () => {
    const lines = FORMATTERS["nearby-walk-infra"]({
      walk: {
        audioSignals: { status: "unsupported", reason: "outsideSeoul" },
        osm: { status: "ok", data: { features: [], crossingTotal: 0, tactileTotal: 0 } },
      },
    } as never);
    expect(lines[0]).toBe("음향신호기 정보는 서울만 제공됩니다.");
    expect(lines[lines.length - 1]).toBe("© OpenStreetMap 기여자");
    expect(lines.join("\n")).not.toContain("서울특별시 제공");
  });

  it("osm unsupported(국내 밖)는 그룹별 미제공 문장으로, error 문구와 뭉개지 않는다", () => {
    const lines = FORMATTERS["nearby-walk-infra"]({
      walk: {
        audioSignals: { status: "unsupported", reason: "outsideSeoul" },
        osm: { status: "unsupported", reason: "outsideKorea" },
      },
    } as never);
    expect(lines).toEqual([
      "음향신호기 정보는 서울만 제공됩니다.",
      "횡단보도 정보는 한국에서만 제공됩니다.",
      "점자블록 정보는 한국에서만 제공됩니다.",
    ]);
    // 미제공은 조회 실패가 아니다 — 두 상태가 같은 문장으로 뭉개지면 시각장애 사용자는
    // 화면으로 그 차이를 확인할 수 없다.
    expect(lines.join("\n")).not.toContain("불러오지 못했습니다");
  });

  it("한 소스 error는 실패 문장으로 강등, 다른 소스는 보존한다(부분실패 200)", () => {
    const lines = FORMATTERS["nearby-walk-infra"]({
      walk: {
        audioSignals: { status: "ok", data: { deviceCount: 1, sites: [{ distanceMeters: 80, bearing: "w", deviceCount: 1 }], baseDate: "2026-05-01" } },
        osm: { status: "error" },
      },
    } as never);
    expect(lines[0]).toBe("음향신호기 반경 300m 안 1기");
    expect(lines).toContain("횡단보도·점자블록 정보를 불러오지 못했습니다.");
    expect(lines[lines.length - 1]).toBe("음향신호기: 서울특별시 제공(2026-05-01 기준)");
    expect(lines.join("\n")).not.toContain("OpenStreetMap");
  });
});

describe("station-meta", () => {
  it("영문명·노선·환승·운영기관", () => {
    const lines = FORMATTERS["station-meta"]({
      meta: { name: "강동", nameEn: "Gangdong", lines: ["5호선", "8호선"], isTransfer: true, operator: "서울교통공사" },
    } as never);
    expect(lines).toEqual(["강동역 (Gangdong), 5호선·8호선, 환승역, 서울교통공사"]);
  });

  it("미커버 역이면 못 찾음 한 줄", () => {
    expect(FORMATTERS["station-meta"]({ meta: null } as never)).toEqual(["역 정보를 찾을 수 없습니다."]);
  });

  it("이미 '역'으로 끝나는 역명은 접미사를 중복하지 않는다", () => {
    const lines = FORMATTERS["station-meta"]({
      meta: { name: "서울역", nameEn: "Seoul Station", lines: ["1호선"], isTransfer: false, operator: "서울교통공사" },
    } as never);
    expect(lines[0]).toContain("서울역 (Seoul Station)");
    expect(lines[0]).not.toContain("서울역역");
  });
});

describe("station-metro-facilities", () => {
  it("그룹별 개수 + 시설별 위치·층·가동중지", () => {
    const lines = FORMATTERS["station-metro-facilities"]({
      facilities: {
        groups: [
          {
            kind: "elevator",
            facilities: [
              { name: "엘리베이터-강동 내부 1호기", location: "1번 출구", floors: "지하1층~지상1층", operatingStatus: "normal" },
              { name: "엘리베이터-강동 내부 2호기", location: "3번 출구", floors: undefined, operatingStatus: "stopped" },
            ],
          },
        ],
      },
    } as never);
    expect(lines[0]).toBe("엘리베이터: 2개");
    expect(lines[1]).toBe("엘리베이터-강동 내부 1호기, 1번 출구, 지하1층~지상1층");
    expect(lines[2]).toBe("엘리베이터-강동 내부 2호기, 3번 출구, 가동 중지");
  });

  it("null이면 정보 없음", () => {
    expect(FORMATTERS["station-metro-facilities"]({ facilities: null } as never)).toEqual(["교통약자 시설 정보가 없습니다."]);
  });

  it("보강 그룹(음성유도기·엘리베이터 위치)과 detail·supplementFailed를 낭독한다", () => {
    const lines = FORMATTERS["station-metro-facilities"]({
      facilities: {
        groups: [
          { kind: "voiceGuide", facilities: [{ name: "음성유도기", location: "1번 출구", floors: undefined, detail: undefined, operatingStatus: undefined }] },
          { kind: "elevatorLocation", facilities: [{ name: "엘리베이터", location: "대합실", floors: undefined, detail: "북동쪽 120m", operatingStatus: undefined }] },
        ],
        supplementFailed: true,
      },
    } as never);
    expect(lines).toContain("시각장애인 음성유도기: 1개");
    expect(lines).toContain("엘리베이터 위치: 1개");
    expect(lines).toContain("엘리베이터, 대합실, 북동쪽 120m");
    expect(lines[lines.length - 1]).toBe("일부 시설 정보를 불러오지 못했습니다.");
  });

  it("groups 전멸 + supplementFailed면 실패 문장만(은폐 금지)", () => {
    expect(FORMATTERS["station-metro-facilities"]({
      facilities: { groups: [], supplementFailed: true },
    } as never)).toEqual(["일부 시설 정보를 불러오지 못했습니다."]);
  });

  it("이름·위치 등 모든 필드가 없는 시설은 빈 줄로 출력하지 않는다(실호출 여의도 교통약자 도우미 관찰)", () => {
    const lines = FORMATTERS["station-metro-facilities"]({
      facilities: {
        groups: [
          { kind: "helper", facilities: [{ name: "", location: undefined, floors: undefined, detail: undefined, operatingStatus: undefined }] },
        ],
      },
    } as never);
    expect(lines).toEqual(["교통약자 도우미: 1개"]);
  });
});

describe("station-timetable", () => {
  it("노선·방향별 첫차·막차와 기준 라벨을 낭독한다", () => {
    const lines = FORMATTERS["station-timetable"]({
      timetable: {
        dailyType: "weekday",
        lines: [
          {
            lineName: "5호선",
            directions: [
              { direction: "up", first: { time: "05:31", terminus: "방화" }, last: { time: "00:31", nextDay: true, terminus: "마천" } },
              { direction: "down", first: { time: "05:40", terminus: "하남검단산" }, last: { time: "23:50", terminus: "하남검단산" } },
            ],
          },
        ],
      },
    } as never);
    expect(lines[0]).toBe("평일 기준");
    expect(lines[1]).toBe("5호선 상행, 첫차 05:31 방화행, 막차 익일 00:31 마천행");
    expect(lines[2]).toBe("5호선 하행, 첫차 05:40 하남검단산행, 막차 23:50 하남검단산행");
  });
  it("종착역명이 빈 문자열이면 '행' 없이 시각만 낭독한다(실호출 김포공항 서해선 검출)", () => {
    const lines = FORMATTERS["station-timetable"]({
      timetable: {
        dailyType: "weekday",
        lines: [
          {
            lineName: "서해선",
            directions: [
              { direction: "down", first: { time: "05:21", terminus: "" }, last: { time: "23:27", terminus: "" } },
            ],
          },
        ],
      },
    } as never);
    expect(lines[1]).toBe("서해선 하행, 첫차 05:21, 막차 23:27");
  });
  it("partial이면 기준 라벨 줄에 불완전 안내를 병기한다", () => {
    const lines = FORMATTERS["station-timetable"]({
      timetable: { dailyType: "sunday", partial: true, lines: [] },
    } as never);
    expect(lines[0]).toBe("일요일·공휴일 기준, 일부 노선 정보를 불러오지 못했습니다.");
    expect(lines[1]).toBe("오늘 시간표 정보가 없습니다.");
  });
  it("null(미커버 역·키 없음)은 미제공 문장(3-state)", () => {
    expect(FORMATTERS["station-timetable"]({ timetable: null } as never)).toEqual([
      "이 역은 첫차·막차 정보 제공 대상이 아닙니다.",
    ]);
  });
});

describe("subway-arrival (역명 단건)", () => {
  it("미커버 역(null)과 0건(빈 배열)을 구분", () => {
    expect(FORMATTERS["subway-arrival"]({ arrivals: null } as never)).toEqual([
      "이 역은 실시간 도착 정보 제공 대상이 아닙니다.",
    ]);
    expect(FORMATTERS["subway-arrival"]({ arrivals: { stationName: "서울역", arrivals: [] } } as never)).toEqual([
      "도착 예정 열차 없음.",
    ]);
  });

  it("도착 열차가 있으면 도착 줄만(역 줄 없이)", () => {
    const lines = FORMATTERS["subway-arrival"]({
      arrivals: { stationName: "서울역", arrivals: [{ line: "1호선", trainLineNm: "인천행 - 구로방면", message: "전역 출발", express: false }] },
    } as never);
    expect(lines).toEqual(["1호선, 인천행 - 구로방면, 전역 출발"]);
  });
});

describe("bus-route-stops", () => {
  it("순번. 정류소명", () => {
    const lines = FORMATTERS["bus-route-stops"]({
      stops: [{ order: 1, name: "강동구청" }, { order: 2, name: "길동시장" }],
    } as never);
    expect(lines).toEqual(["1. 강동구청", "2. 길동시장"]);
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["bus-route-stops"]({ stops: [] } as never)).toEqual(["경유 정류소 정보가 없습니다."]);
  });
});

describe("route-car", () => {
  it("요약 줄 + 안내 줄(통행료 0원은 생략)", () => {
    const lines = FORMATTERS["route-car"]({
      distanceMeters: 5320, durationSeconds: 1140, taxiFare: 12000, tollFare: 0,
      guides: [{ name: "", guidance: "염천교에서 좌회전", distanceMeters: 120, durationSeconds: 30 }, { name: "", guidance: "직진", distanceMeters: 300, durationSeconds: 60 }],
    } as never);
    expect(lines[0]).toBe("5.32km, 약 19분, 택시 약 12,000원");
    expect(lines[1]).toBe("1. 염천교에서 좌회전, 120m");
    expect(lines[2]).toBe("2. 직진, 300m");
  });

  it("통행료가 있으면 표기", () => {
    const lines = FORMATTERS["route-car"]({
      distanceMeters: 1000, durationSeconds: 60, taxiFare: 3000, tollFare: 2500, guides: [],
    } as never);
    expect(lines[0]).toContain("통행료 2,500원");
  });

  it("guide distanceMeters 0(Tmap 문장 내장)은 '0m' 병기 없이 안내문만", () => {
    const lines = FORMATTERS["route-car"]({
      distanceMeters: 5320, durationSeconds: 1140, taxiFare: 12000, tollFare: 0,
      guides: [{ name: "", guidance: "염천교에서 좌회전 후 200m 직진", distanceMeters: 0, durationSeconds: 30 }],
    } as never);
    expect(lines[1]).toBe("1. 염천교에서 좌회전 후 200m 직진");
  });
});

describe("route-transit", () => {
  it("경로 없으면 못 찾음 한 줄", () => {
    expect(FORMATTERS["route-transit"]({ result: null } as never)).toEqual(["대중교통 경로를 찾을 수 없습니다."]);
  });

  it("추천+대안 경로, 다리(leg)별 도보/환승 줄", () => {
    const lines = FORMATTERS["route-transit"]({
      result: {
        recommended: {
          summary: { totalMinutes: 35, fare: 1500, transfers: 1, walkMinutes: 8 },
          legs: [
            { mode: "walk", toName: "강동", minutes: 5, distanceMeters: 320 },
            { mode: "subway", lineName: "5호선", fromName: "강동", toName: "천호", stationCount: 3, minutes: 12 },
            { mode: "walk", minutes: 3, distanceMeters: 180 },
          ],
        },
        alternatives: [
          {
            summary: { totalMinutes: 42, fare: 1500, transfers: 0, walkMinutes: 10 },
            legs: [{ mode: "bus", lineName: "302", fromName: "길동사거리", toName: "천호역", stationCount: 5, minutes: 20 }],
            displayIndex: 1,
          },
        ],
      },
    } as never);
    expect(lines).toContain("추천 경로");
    expect(lines).toContain("약 35분, 요금 1,500원, 환승 1회, 도보 8분");
    expect(lines).toContain("강동까지 도보 5분, 320m");
    expect(lines).toContain("목적지까지 도보 3분, 180m");
    expect(lines).toContain("5호선 강동→천호, 3개 역, 12분");
    expect(lines).toContain("대안 경로 1");
    expect(lines).toContain("302 길동사거리→천호역, 5개 역, 20분");
  });

  it("배차간격이 있으면 구간 줄에 병기한다", () => {
    const lines = FORMATTERS["route-transit"]({
      result: {
        recommended: {
          summary: { totalMinutes: 30, fare: 1500, transfers: 0, walkMinutes: 5 },
          legs: [{ mode: "subway", lineName: "5호선", fromName: "길동", toName: "강남", stationCount: 10, minutes: 25, intervalMinutes: 6 }],
        },
        alternatives: [],
      },
    } as never);
    expect(lines).toContain("5호선 길동→강남, 10개 역, 25분, 배차간격 약 6분");
  });
});

describe("route-walk", () => {
  it("요약 줄 + 안내 줄(description 그대로, 재조합 없음)", () => {
    const lines = FORMATTERS["route-walk"]({
      result: {
        distanceMeters: 850, durationSeconds: 660,
        steps: [
          { description: "158m 이동 후 우회전" },
          { description: "목적지 도착" },
        ],
      },
    } as never);
    expect(lines[0]).toBe("850m, 약 11분");
    expect(lines[1]).toBe("1. 158m 이동 후 우회전");
    expect(lines[2]).toBe("2. 목적지 도착");
  });

  it("result null(3102 경로 없음)은 미발견 문장(크래시 금지)", () => {
    expect(FORMATTERS["route-walk"]({ result: null } as never)).toEqual(["도보 경로를 찾을 수 없습니다."]);
  });
});

describe("weather", () => {
  it("null(키 부재)은 실패 문장과 구분해 '제공되지 않습니다'", () => {
    expect(FORMATTERS["weather"]({ weather: null } as never)).toEqual(["날씨 정보가 제공되지 않습니다."]);
  });

  it("정상 데이터는 한 줄로 결합, none/unknown은 생략", () => {
    const lines = FORMATTERS["weather"]({
      weather: {
        sky: { code: 1, label: "clear" }, precipitation: { code: 0, label: "none" },
        tempC: 23.5, tempMax: 26, tempMin: 18, humidity: 55, precipProbability: 20, baseTime: "14:00",
      },
    } as never);
    expect(lines).toEqual(["맑음, 현재 23.5도, 최고 26, 최저 18, 습도 55%, 강수확률 20%, 14:00 기준"]);
  });

  it("partlyCloudy는 '구름많음'으로 포매팅", () => {
    const lines = FORMATTERS["weather"]({
      weather: {
        sky: { code: 3, label: "partlyCloudy" }, precipitation: { code: 0, label: "none" },
        tempC: 20, tempMax: 24, tempMin: 16, humidity: 60, precipProbability: 10, baseTime: "10:00",
      },
    } as never);
    expect(lines[0]).toContain("구름많음");
  });
});

describe("air-quality", () => {
  it("null(키 부재/측정소 없음)은 '제공되지 않습니다'", () => {
    expect(FORMATTERS["air-quality"]({ air: null } as never)).toEqual(["공기질 정보가 제공되지 않습니다."]);
  });

  it("등급 한글 + 수치, unknown은 '측정 정보 없음'", () => {
    const lines = FORMATTERS["air-quality"]({
      air: {
        stationName: "강동구", distanceKm: 1.2, dataTime: "2026-07-15 14:00",
        khai: { value: 45, grade: "good" }, pm10: { value: 30, grade: "moderate" }, pm25: { value: null, grade: "unknown" },
      },
    } as never);
    expect(lines[0]).toBe("강동구 측정소, 1.2km, 2026-07-15 14:00");
    expect(lines[1]).toBe("통합 좋음, 45");
    expect(lines[2]).toBe("미세먼지 보통, 30");
    expect(lines[3]).toBe("초미세먼지 측정 정보 없음");
  });
});

describe("nearby-congestion", () => {
  it("area null(핫스팟 밖)은 오류가 아닌 대상 제외 안내 한 줄", () => {
    expect(FORMATTERS["nearby-congestion"]({ area: null } as never)).toEqual([
      "이 지역은 실시간 혼잡도 제공 대상이 아닙니다.",
    ]);
  });

  it("영역명·등급·기준시각 한 줄 + 완성 문장 별도 줄", () => {
    const lines = FORMATTERS["nearby-congestion"]({
      area: {
        code: "POI014", name: "강남역", level: "붐빔",
        message: "사람이 몰려 있어 붐빕니다. 이동시 주의하세요.",
        asOf: "2026-08-01 15:00",
      },
    } as never);
    expect(lines).toEqual([
      "강남역 혼잡도 붐빔, 2026-08-01 15:00 기준",
      "사람이 몰려 있어 붐빕니다. 이동시 주의하세요.",
    ]);
  });

  it("완성 문장이 비면 그 줄을 만들지 않는다(빈 줄 낭독 금지)", () => {
    const lines = FORMATTERS["nearby-congestion"]({
      area: { code: "POI014", name: "강남역", level: "여유", message: "", asOf: "2026-08-01 04:00" },
    } as never);
    expect(lines).toEqual(["강남역 혼잡도 여유, 2026-08-01 04:00 기준"]);
  });
});

describe("where-am-i", () => {
  it("null(키 부재)은 제공되지 않음", () => {
    expect(FORMATTERS["where-am-i"]({ data: null } as never)).toEqual(["현재 위치 정보가 제공되지 않습니다."]);
  });

  it("행정동/역/기준점", () => {
    const lines = FORMATTERS["where-am-i"]({
      data: {
        region: "서울특별시 강동구 길동", address: null,
        nearestStation: { name: "강동역", line: "5호선", bearing: "ne", distanceMeters: 300 },
        landmarks: [{ name: "강동구청", categoryRaw: "공공기관 > 주민센터", distanceMeters: 150, bearing: "n" }],
      },
    } as never);
    expect(lines[0]).toBe("서울특별시 강동구 길동");
    expect(lines[1]).toBe("가까운 역: 강동역, 5호선, 300m 북동");
    expect(lines[2]).toBe("강동구청, 주민센터, 150m 북");
  });
});

describe("web-search", () => {
  it("title/snippet/url 3줄 + 항목 간 빈 줄", () => {
    const lines = FORMATTERS["web-search"]({
      web: [
        { title: "제목1", url: "https://a.com", snippet: "요약1", date: null },
        { title: "제목2", url: "https://b.com", snippet: "요약2", date: null },
      ],
    } as never);
    expect(lines).toEqual(["제목1", "요약1", "https://a.com", "", "제목2", "요약2", "https://b.com"]);
  });

  it("0건이면 없음 한 줄", () => {
    expect(FORMATTERS["web-search"]({ web: [] } as never)).toEqual(["검색 결과가 없습니다."]);
  });
});

describe("barrier-free-detail", () => {
  it("이름 줄 + 시설 label: value 줄", () => {
    const lines = FORMATTERS["barrier-free-detail"]({
      detail: { contentId: "1", name: "경복궁", facilities: [{ key: "wheelchair", label: "휠체어 대여", value: "가능" }] },
    } as never);
    expect(lines).toEqual(["경복궁", "휠체어 대여: 가능"]);
  });

  it("빈 배열이면 등록된 정보 없음", () => {
    const lines = FORMATTERS["barrier-free-detail"]({
      detail: { contentId: "2", name: "OO공원", facilities: [] },
    } as never);
    expect(lines).toEqual(["OO공원", "등록된 편의시설 정보가 없습니다."]);
  });

  it("null(키 부재)이면 제공되지 않음", () => {
    expect(FORMATTERS["barrier-free-detail"]({ detail: null } as never)).toEqual([
      "이 장소의 편의시설 정보가 제공되지 않습니다.",
    ]);
  });
});

describe("nearby-subway 0건 — 최근접 역 동봉", () => {
  it("nearest가 있으면 역명·노선·거리를 함께 알린다", () => {
    const lines = FORMATTERS["nearby-subway"]({
      stations: [],
      // provider가 cleanName으로 접미사를 떼고 주므로 "남춘천"이 온다. 여기에
      // fixture를 "남춘천역"으로 두면 "남춘천역역"이 되는 회귀를 못 잡는다
      // (원본 seed 1,098건 중 358건이 "역"으로 끝나 실제로 밟는 경로다).
      nearest: { stationName: "남춘천", lines: ["경춘선"], distanceMeters: 103_888 },
    } as never);
    const out = lines.join("\n");
    expect(out).toContain("주변에 지하철역이 없습니다");
    expect(out).toContain("남춘천역");
    expect(out).not.toContain("남춘천역역");
    expect(out).toContain("경춘선");
    expect(out).toContain("103.888km"); // 이 수치가 "이 지역엔 도시철도가 없다"를 말한다
  });

  it("nearest가 없으면 종전 문구 그대로(스키마 하위호환)", () => {
    const lines = FORMATTERS["nearby-subway"]({ stations: [] } as never);
    expect(lines).toEqual(["주변에 지하철역이 없습니다."]);
  });
});
