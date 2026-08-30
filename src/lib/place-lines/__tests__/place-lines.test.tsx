// @vitest-environment jsdom
/**
 * place-lines == 화면 문장 대조(spec 2026-08-29 §3.3 "문장은 화면과 같은 함수").
 * 컴포넌트를 실제로 렌더한 textContent가 lib 함수 출력과 정확히 같아야 한다 —
 * 도구가 돌려준 줄과 SR 커서가 착지해 듣는 줄이 갈리면 사용자에겐 반증 채널이 없다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// 네임스페이스를 키에 접두해 `t`가 어느 네임스페이스에서 왔는지까지 대조한다.
const tFor =
  (ns: string) =>
  (key: string, values?: Record<string, string | number>) =>
    values ? `${ns}.${key}${JSON.stringify(values)}` : `${ns}.${key}`;

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => tFor(ns),
  useLocale: () => "ko",
}));

import { stationMetaLines } from "../station-meta";
import { timetableHeaderLine, timetableLineItems } from "../station-timetable";
import { korailFacilityLines } from "../station-facilities";
import { metroFacilityGroups } from "../station-metro";
import { arrivalItems } from "../station-arrivals";
import { barrierFreeLines } from "../barrier-free";
import { StationMeta } from "@/components/StationMeta";
import { StationTimetable } from "@/components/StationTimetable";
import { StationFacilities } from "@/components/StationFacilities";
import { SeoulMetroFacilities } from "@/components/SeoulMetroFacilities";
import { SubwayArrivalList } from "@/components/SubwayArrivalList";
import { BarrierFreeInfo } from "@/components/BarrierFreeInfo";
import type {
  BarrierFreeDetail,
  SeoulMetroFacilities as Metro,
  StationFacilities as Facilities,
  StationMeta as Meta,
  StationTimetable as Timetable,
  SubwayArrival,
} from "@/lib/types";

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("place-lines == 화면 문장", () => {
  it("역 메타 3줄(영문역명·노선+환승·운영기관)", async () => {
    const meta: Meta = {
      name: "강동",
      nameEn: "Gangdong",
      lines: ["5호선", "8호선"],
      isTransfer: true,
      operator: "서울교통공사",
    };
    stubFetch({ meta });
    const { container } = render(<StationMeta stationName="강동" />);
    await screen.findByText("Gangdong");
    // 헤딩·출처를 제외한 본문 <p> 3줄
    const ps = Array.from(container.querySelectorAll("section p")).slice(0, 3);
    expect(ps.map((p) => p.textContent)).toEqual(stationMetaLines(meta, tFor("stationMeta")));
    // 리터럴 기대값 — 컴포넌트가 같은 함수를 부르므로 렌더 대조만으론 문장 변이를 못 잡는다.
    expect(stationMetaLines(meta, tFor("stationMeta"))).toEqual([
      "Gangdong",
      "stationMeta.lines 5호선, 8호선, stationMeta.transfer",
      "stationMeta.operator 서울교통공사",
    ]);
  });

  it("시간표 헤더 + 노선 항목(ok는 방향별, 비-ok는 사유 한 줄)", async () => {
    const tt: Timetable = {
      stationName: "홍대입구",
      dailyType: "weekday",
      partial: true,
      lines: [
        {
          lineName: "공항철도",
          coverage: "ok",
          directions: [
            {
              direction: "up",
              first: { time: "05:31", terminus: "서울역" },
              last: { time: "00:31", nextDay: true, terminus: "김포공항", terminusEn: "Gimpo" },
            },
          ],
        },
        { lineName: "2호선", coverage: "unknown", directions: [] },
        { lineName: "경의중앙선", coverage: "noTrains", directions: [] },
      ],
    };
    stubFetch({ timetable: tt });
    const { container } = render(<StationTimetable stationName="홍대입구" />);
    await screen.findByText(/공항철도/);
    const t = tFor("timetable");
    const [header, ...rest] = Array.from(container.querySelectorAll("section p"));
    expect(header.textContent).toBe(timetableHeaderLine(tt, t));
    expect(timetableHeaderLine(tt, t)).toBe("timetable.dailyType.weekday, timetable.partial");
    const items = timetableLineItems(tt, t, false);
    // 마지막 <p>는 출처 각주
    expect(rest.slice(0, -1).map((p) => p.textContent)).toEqual(items.map((i) => i.text));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      line: "공항철도",
      coverage: "ok",
      direction: "up",
      first: 'timetable.nextDay 05:31 timetable.toTerminus{"terminus":"서울역"}'.replace("timetable.nextDay ", ""),
      last: 'timetable.nextDay 00:31 timetable.toTerminus{"terminus":"김포공항"}',
      text: '공항철도 timetable.direction.up, timetable.first 05:31 timetable.toTerminus{"terminus":"서울역"}, timetable.last timetable.nextDay 00:31 timetable.toTerminus{"terminus":"김포공항"}',
    });
    expect(items[1]).toEqual({ line: "2호선", coverage: "unknown", text: 'timetable.coverage.unknown{"line":"2호선"}' });
    expect(items[2].coverage).toBe("noTrains");
    // en은 terminusEn을 쓴다
    expect(timetableLineItems(tt, t, true)[0].last).toContain('"terminus":"Gimpo"');
  });

  it("코레일 시설 4줄", async () => {
    const f: Facilities = {
      stationName: "서울역",
      accessibleToilet: true,
      accessibleSlope: false,
      wheelchairLifts: undefined,
      elevators: 3,
    };
    stubFetch({ facilities: f });
    render(<StationFacilities stationName="서울역" />);
    fireEvent.click(screen.getByRole("button"));
    const items = await screen.findAllByRole("listitem");
    const lines = korailFacilityLines(f, tFor("station"));
    expect(items.map((li) => li.textContent)).toEqual(lines);
    expect(lines).toEqual([
      "station.accessibleToilet: station.yes",
      "station.accessibleSlope: station.no",
      "station.wheelchairLifts: station.unknown",
      "station.elevators: 3",
    ]);
  });

  it("서울 지하철 시설 그룹 헤딩 + 시설 줄", async () => {
    const f: Metro = {
      stationName: "강동",
      line: "5호선",
      groups: [
        {
          kind: "elevator",
          facilities: [
            { name: "엘리베이터 1호기", location: "1번 출구", floors: "지하1층~지상", detail: undefined, operatingStatus: "normal" },
            { name: "엘리베이터 2호기", location: undefined, floors: undefined, detail: "휠체어 가능", operatingStatus: "stopped" },
          ],
        },
        { kind: "voiceGuide", facilities: [{ name: "음성유도기", location: "2번 출구", floors: undefined, detail: undefined, operatingStatus: undefined }] },
      ],
    };
    stubFetch({ facilities: f });
    const { container } = render(<SeoulMetroFacilities stationName="강동" />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findAllByRole("listitem");
    const groups = metroFacilityGroups(f, tFor("subway"));
    const h4s = Array.from(container.querySelectorAll("h4")).map((h) => h.textContent);
    expect(h4s).toEqual(groups.map((g) => g.name));
    const uls = Array.from(container.querySelectorAll("ul"));
    expect(uls.map((ul) => Array.from(ul.querySelectorAll("li")).map((li) => li.textContent))).toEqual(
      groups.map((g) => g.lines),
    );
    expect(groups[0].name).toBe('subway.kind.elevator subway.count{"count":2}');
    expect(groups[0].lines).toEqual([
      "엘리베이터 1호기, 1번 출구, 지하1층~지상, subway.operatingNormal",
      "엘리베이터 2호기, 휠체어 가능, subway.operatingStopped",
    ]);
  });

  it("필드가 전부 빈 시설 항목은 줄을 만들지 않는다(빈 li = 이름 없는 항목, 헤딩의 수는 유지)", () => {
    const f: Metro = {
      groups: [
        {
          kind: "helper",
          facilities: [
            { name: "", location: undefined, floors: undefined, detail: undefined, operatingStatus: undefined },
            { name: "", location: undefined, floors: undefined, detail: undefined, operatingStatus: undefined },
          ],
        },
      ],
    } as Metro;
    const groups = metroFacilityGroups(f, tFor("subway"));
    expect(groups[0].name).toBe('subway.kind.helper subway.count{"count":2}');
    expect(groups[0].lines).toEqual([]);
  });

  it("도착 항목의 line·message 두 줄", () => {
    const arrivals: SubwayArrival[] = [
      {
        line: "2호선",
        direction: "외선",
        trainLineNm: "성수행 - 역삼방면",
        destination: "성수",
        message: "3분 후(2번째 전)",
        currentLocation: "방배",
        arrivalSeconds: 180,
        express: false,
      },
      {
        direction: "상행",
        trainLineNm: "신사행 - 신논현방면",
        destination: "신사",
        message: "곧 도착",
        arrivalSeconds: 0,
        express: true,
      },
    ];
    const { container } = render(<SubwayArrivalList arrivals={arrivals} />);
    const items = arrivalItems(arrivals, tFor("subwayArrival"));
    const lis = Array.from(container.querySelectorAll("li"));
    expect(lis.map((li) => Array.from(li.querySelectorAll("div")).map((d) => d.textContent))).toEqual(
      items.map((i) => [i.line, i.message]),
    );
    expect(items[0]).toEqual({
      line: "2호선 외선, 성수행 - 역삼방면",
      direction: "외선",
      message: '3분 후(2번째 전), subwayArrival.currentLocation{"location":"방배"}',
      state: { kind: "ok" },
    });
    expect(items[1].line).toBe("상행, 신사행 - 신논현방면, subwayArrival.express");
    expect(items[1].message).toBe("곧 도착");
  });

  it("무장애 라벨+값 줄", async () => {
    const d: BarrierFreeDetail = {
      contentId: "1",
      name: "경복궁",
      facilities: [
        { key: "wheelchair", label: "휠체어 대여", value: "안내소에서 대여 가능" },
        { key: "restroom", label: "장애인 화장실", value: "있음" },
      ],
    };
    stubFetch({ detail: d });
    const { container } = render(<BarrierFreeInfo lat={37.5} lng={127} name="경복궁" />);
    await screen.findByText(/안내소에서 대여 가능/);
    const lines = barrierFreeLines(d, tFor("barrierFreeInfo"));
    const ps = Array.from(container.querySelectorAll('p[lang="ko"]')).map((p) => p.textContent);
    expect(ps).toEqual(lines.map((l) => l.text));
    // 라벨은 서버 한글이 아니라 key→t() 매핑(A26). 값은 서버 원문.
    expect(lines[0]).toEqual({
      label: "barrierFreeInfo.facility.wheelchair",
      value: "안내소에서 대여 가능",
      text: "barrierFreeInfo.facility.wheelchair 안내소에서 대여 가능",
    });
  });

  it("무장애 미지 key는 서버 라벨로 폴백한다(신규 필드가 빈 라벨로 떨어지지 않게)", () => {
    const lines = barrierFreeLines(
      { contentId: "1", name: "x", facilities: [{ key: "newfield", label: "새 편의", value: "있음" }] },
      tFor("barrierFreeInfo"),
    );
    expect(lines[0]).toEqual({ label: "새 편의", value: "있음", text: "새 편의 있음" });
  });

  it("서울 지하철 시설 — 서버 구조화 조각(parts)이 있으면 클라이언트가 자기 언어로 조립한다(A26)", () => {
    const f: Metro = {
      stationName: "강동",
      groups: [
        {
          kind: "elevatorLocation",
          facilities: [
            {
              name: "역 중심 기준 북동쪽 약 120m, 성내동",
              location: undefined, floors: undefined, operatingStatus: undefined, detail: undefined,
              parts: { compass: "ne", meters: 120, dong: "성내동" },
            },
          ],
        },
        {
          kind: "voiceGuide",
          facilities: [
            {
              name: "3번 출구 5호선", location: undefined, floors: undefined, operatingStatus: undefined, detail: undefined,
              parts: { location: "3번 출구", line: "5" },
            },
            {
              name: "4번 출구", location: undefined, floors: undefined, operatingStatus: undefined, detail: undefined,
              parts: { location: "4번 출구" },
            },
          ],
        },
        {
          kind: "restroom",
          facilities: [
            {
              name: "장애인화장실", location: "대합실", floors: "지하1층", operatingStatus: undefined,
              detail: "남녀구분 · 휠체어 접근 가능",
              parts: { restroomType: "남녀구분", wheelchairAccessible: true },
            },
          ],
        },
      ],
    } as Metro;
    const groups = metroFacilityGroups(f, tFor("subway"));
    expect(groups[0].lines).toEqual([
      'subway.elevatorAt{"direction":"subway.direction.ne","distance":"120m"}, 성내동',
    ]);
    expect(groups[1].lines).toEqual(['3번 출구, subway.lineNumber{"line":"5"}', "4번 출구"]);
    expect(groups[2].lines).toEqual(["장애인화장실, 대합실, 지하1층, 남녀구분, subway.wheelchairAccessible"]);
  });

  it("시간표 — 서버가 '선'을 덧붙인 노선(lineCore)은 클라이언트가 접미를 자기 언어로 단다(A26)", () => {
    const tt: Timetable = {
      stationName: "왕십리",
      dailyType: "weekday",
      lines: [
        { lineName: "수인분당선", lineCore: "수인분당", coverage: "unknown", directions: [] },
        { lineName: "2호선", coverage: "unknown", directions: [] },
      ],
    };
    const items = timetableLineItems(tt, tFor("timetable"), false);
    expect(items[0].line).toBe('timetable.lineSuffixed{"name":"수인분당"}');
    expect(items[0].text).toBe('timetable.coverage.unknown{"line":"timetable.lineSuffixed{\\"name\\":\\"수인분당\\"}"}');
    expect(items[1].line).toBe("2호선");
  });
});
