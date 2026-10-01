import { describe, expect, it } from "vitest";
import { buildSeoulWalkNetwork, linkKind, parseCsvLine, parseLine, parsePoint } from "./build-seoul-walk-network.mjs";

const HEADER = [
  "노드링크 유형", "노드 WKT", "노드 ID", "노드 유형 코드", "링크 WKT", "링크 ID", "링크 유형 코드", "시작노드 ID",
  "종료노드 ID", "링크 길이", "시군구코드", "시군구명", "읍면동코드", "읍면동명", "고가도로", "지하철네트워크", "교량",
  "터널", "육교", "횡단보도", "공원,녹지", "건물내", "수집일자",
];
const deg = (m) => m / 111_320;
const lng = (m) => m / (111_320 * Math.cos((37.5 * Math.PI) / 180));
const node = (id, north, east, cw = "0") => {
  const r = Array(23).fill("0");
  r[0] = "NODE";
  r[1] = `POINT(${127 + lng(east)} ${37.5 + deg(north)})`;
  r[2] = id;
  r[3] = "0";
  r[19] = cw;
  return r;
};
const link = (id, from, to, code, pts, flags = {}) => {
  const r = Array(23).fill("0");
  r[0] = "LINK";
  r[4] = `LINESTRING(${pts.map(([n, e]) => `${127 + lng(e)} ${37.5 + deg(n)}`).join(",")})`;
  r[5] = id;
  r[6] = code;
  r[7] = from;
  r[8] = to;
  for (const [k, v] of Object.entries(flags)) r[HEADER.indexOf(k)] = v;
  return r;
};

describe("CSV·WKT 파싱", () => {
  it("따옴표 안 쉼표(WKT)와 이스케이프 따옴표", () => {
    expect(parseCsvLine('"LINK","LINESTRING(1 2,3 4)","a""b",""')).toEqual(["LINK", "LINESTRING(1 2,3 4)", 'a"b', ""]);
    expect(parsePoint("POINT(127.1 37.5)")).toEqual([37.5, 127.1]);
    expect(parseLine("LINESTRING(127 37,128 38)")).toEqual([[37, 127], [38, 128]]);
  });

  it("링크 유형: 보행 불가는 null, 차량 겸용은 골목, 보행 전용은 보행로", () => {
    expect(linkKind("0100")).toBeNull();
    expect(linkKind("1111")).toBe(0);
    expect(linkKind("1011")).toBe(2);
  });
});

describe("buildSeoulWalkNetwork", () => {
  // 골목 T자(A-B-C, B-D) + 그 옆 횡단보도 쌍(E-F, 양 끝 횡단보도 노드) + 짝 없는 횡단보도 노드 G.
  const rows = [
    node("A", -40, 0), node("B", 0, 0), node("C", 40, 0), node("D", 0, -40),
    node("E", 0, 30, "1"), node("F", 0, 41, "1"), node("G", 80, 0, "1"),
    link("1", "A", "B", "1111", [[-40, 0], [0, 0]]),
    link("2", "B", "C", "1111", [[0, 0], [40, 0]]),
    // WKT가 끝 노드에서 시작해도 방향을 맞춘다.
    link("3", "B", "D", "1000", [[0, -40], [0, 0]]),
    // 횡단보도 짝 링크 — 시설 플래그 열은 믿지 않는다(실데이터는 '건물내' 열에 1이 온다).
    link("4", "E", "F", "1000", [[0, 30], [0, 41]], { 건물내: "1" }),
    link("5", "C", "G", "1111", [[40, 0], [80, 0]]),
  ];

  it("횡단보도 쌍은 중점 하나로, 짝 없는 횡단보도 노드는 노드 자체로", () => {
    const out = buildSeoulWalkNetwork(rows, HEADER);
    expect(out.crosswalks).toHaveLength(2);
    const mid = out.crosswalks.find(([a]) => Math.abs(a - 37.5) < 1e-6);
    expect(mid[1]).toBeCloseTo(127 + lng(35.5), 5);
  });

  it("교차점: 횡단보도 링크를 뺀 3갈래 노드, 차량 겸용은 골목·보행 전용은 보행로", () => {
    const out = buildSeoulWalkNetwork(rows, HEADER);
    expect(out.junctions).toHaveLength(1);
    expect(out.junctions[0][2]).toEqual([0 * 36 + 0, 0 * 36 + 18, 2 * 36 + 27]);
  });

  it("제공 칸은 노드가 있는 0.01도 칸", () => {
    // B(원점)·D(서쪽 40m, 127도 아래 칸)·A(남쪽 40m, 37.5도 아래 칸).
    expect(buildSeoulWalkNetwork(rows, HEADER).cells).toEqual([374912700, 375012699, 375012700]);
  });
});
