// A43 — 도시철도 seed 변환기의 가드: `환승역구분` 접미 일치 + 모르는 값이면 중단, 직전 seed 대비 좌표 이동이면 중단.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/build-subway-stations.py");
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** 스크립트를 모듈로 올려 파이썬 코드를 돌린다(파일명에 하이픈이 있어 importlib 경유). */
function py(code, args = []) {
  const prelude = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location("bss", ${JSON.stringify(script)})`,
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
  ].join("\n");
  return spawnSync("python3", ["-c", `${prelude}\n${code}`, ...args], { encoding: "utf8" });
}

// 루트 게이트는 Windows 클론에서도 돈다 — python3가 없으면 실패가 아니라 건너뛴다.
const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe.skipIf(!hasPython)("is_transfer (A43)", () => {
  it("알려진 어휘 4종 — 신분당선의 `도시철도 …`도 접미로 판정한다", () => {
    const r = py(
      'print(json.dumps([m.is_transfer(v) for v in ["환승역", "일반역", "도시철도 환승역", "도시철도 일반역", "  환승역 "]]))',
    );
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual([true, false, true, false, true]);
  });

  it("모르는 값(빈 값 포함)은 ValueError — 조용히 일반역으로 접지 않는다", () => {
    const r = py(
      [
        "out = []",
        'for v in ["경전철 환승역", "환승", "도시철도환승역", None, "", "-"]:',
        "    try: m.is_transfer(v); out.append('pass')",
        "    except ValueError: out.append('raise')",
        "print(json.dumps(out))",
      ].join("\n"),
    );
    expect(JSON.parse(r.stdout)).toEqual(Array(6).fill("raise"));
  });
});

const hasOpenpyxl = hasPython && spawnSync("python3", ["-c", "import openpyxl"]).status === 0;

describe.skipIf(!hasOpenpyxl)("main — 모르는 어휘가 섞인 XLSX", () => {
  it("종료 코드 1로 중단하고 seed를 쓰지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "subway-stations-test-"));
    dirs.push(dir);
    const xlsx = join(dir, "stations.xlsx");
    const header = ["역번호", "역사명", "노선번호", "노선명", "영문역사명", "한자역사명",
      "환승역구분", "환승노선번호", "환승노선명", "역위도", "역경도",
      "운영기관명", "역사도로명주소", "역사전화번호", "데이터기준일자"];
    const row = (name, type) => ["1", name, "L1", "가상선", "", "", type, "", "", 37.5, 127.0, "가상공사", "", "", "2026-06-30"];
    const made = spawnSync("python3", ["-c", [
      "import json, sys, openpyxl",
      "wb = openpyxl.Workbook(); ws = wb.active",
      "for r in json.loads(sys.argv[2]): ws.append(r)",
      "wb.save(sys.argv[1])",
    ].join("\n"), xlsx, JSON.stringify([header, row("가상역", "환승역"), row("나상역", "경전철 환승역")])], { encoding: "utf8" });
    expect(made.status, made.stderr).toBe(0);

    // 회귀하면 main이 seed를 쓰므로 출력 경로를 임시 디렉터리로 돌려 놓고 돌린다(실 seed 불가침).
    const out = join(dir, "out.json");
    const r = py(
      [
        "from pathlib import Path",
        "m.OUT = Path(sys.argv[2])",
        'sys.argv = ["build-subway-stations.py", sys.argv[1]]',
        "m.main()",
      ].join("\n"),
      [xlsx, out],
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("모르는 환승역구분 값");
    expect(r.stderr).toContain("경전철 환승역");
    expect(existsSync(out)).toBe(false);
  });
});

// 직전 seed 대비 좌표 이동 가드 — 2026-06-30판 신분당선 11역 퇴행(18~120m)이 두 거리 가드를 통과한 실측이 근거.
describe.skipIf(!hasPython)("coord_shift_outliers", () => {
  // 위도 0.0001도 ≈ 11.1m
  const rec = (name, lat, lng = 127.0, line = "가상선") => ({ name, lineName: line, lat, lng });
  const run = (prev, next, accepted = []) =>
    py(
      [
        "a = json.loads(sys.argv[1]); b = json.loads(sys.argv[2])",
        "acc = {(n, l): (la, lo) for n, l, la, lo in json.loads(sys.argv[3])}",
        "print(json.dumps(m.coord_shift_outliers(a, b, acc), ensure_ascii=False))",
      ].join("\n"),
      [JSON.stringify(prev), JSON.stringify(next), JSON.stringify(accepted)],
    );

  it("15m 이하 이동은 통과하고 넘으면 역 이름과 거리를 낸다", () => {
    const r = run(
      [rec("가", 37.5), rec("나", 37.5), rec("다", 37.5)],
      [rec("가", 37.5), rec("나", 37.5001), rec("다", 37.50015)],
    );
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual(["다(가상선) 직전 seed 대비 17m 이동 → (37.50015, 127)"]);
  });

  it("노선이 다르면 같은 역명이라도 다른 키다 — 직전에 없던 키(신설역)는 비교하지 않는다", () => {
    const r = run([rec("가", 37.5, 127.0, "1호선")], [rec("가", 37.6, 127.0, "2호선")]);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });

  it("같은 키가 여러 행이면 직전 행 중 최근접과 비교한다(주안역 경인선 중복 행)", () => {
    const r = run([rec("가", 37.5), rec("가", 37.6)], [rec("가", 37.6), rec("가", 37.5)]);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });

  it("허용은 키가 아니라 그 좌표다 — 허용한 좌표와 다르게 움직이면 다시 잡는다", () => {
    const ok = run([rec("가", 37.5)], [rec("가", 37.501)], [["가", "가상선", 37.501, 127.0]]);
    expect(JSON.parse(ok.stdout)).toEqual([]);
    const moved = run([rec("가", 37.5)], [rec("가", 37.502)], [["가", "가상선", 37.501, 127.0]]);
    expect(JSON.parse(moved.stdout)).toHaveLength(1);
  });
});

describe.skipIf(!hasOpenpyxl)("main — 직전 seed에서 좌표가 움직인 XLSX", () => {
  const header = ["역번호", "역사명", "노선번호", "노선명", "영문역사명", "한자역사명",
    "환승역구분", "환승노선번호", "환승노선명", "역위도", "역경도",
    "운영기관명", "역사도로명주소", "역사전화번호", "데이터기준일자"];
  const row = (name, lat) => ["1", name, "L1", "가상선", "", "", "일반역", "", "", lat, 127.0, "가상공사", "", "", "2026-06-30"];

  it("종료 코드 1로 중단하고 직전 seed를 그대로 둔다", () => {
    const dir = mkdtempSync(join(tmpdir(), "subway-stations-test-"));
    dirs.push(dir);
    const xlsx = join(dir, "stations.xlsx");
    const made = spawnSync("python3", ["-c", [
      "import json, sys, openpyxl",
      "wb = openpyxl.Workbook(); ws = wb.active",
      "for r in json.loads(sys.argv[2]): ws.append(r)",
      "wb.save(sys.argv[1])",
    ].join("\n"), xlsx, JSON.stringify([header, row("가상역", 37.5), row("나상역", 37.501)])], { encoding: "utf8" });
    expect(made.status, made.stderr).toBe(0);

    const out = join(dir, "out.json");
    const prev = JSON.stringify([
      { name: "가상역", lineName: "가상선", lat: 37.5, lng: 127.0 },
      { name: "나상역", lineName: "가상선", lat: 37.5, lng: 127.0 },
    ]);
    writeFileSync(out, prev);
    const r = py(
      [
        "from pathlib import Path",
        "m.OUT = Path(sys.argv[2])",
        'sys.argv = ["build-subway-stations.py", sys.argv[1]]',
        "m.main()",
      ].join("\n"),
      [xlsx, out],
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("직전 seed 대비 좌표 이동 1건");
    expect(r.stderr).toContain("나상역(가상선)");
    expect(r.stderr).not.toContain("가상역(가상선)");
    expect(readFileSync(out, "utf8")).toBe(prev);
  });

  it("COORD_FIXES의 보정 좌표로 움직인 것은 허용한다 — 보정을 새로 더해도 두 표에 이중 등록하지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "subway-stations-test-"));
    dirs.push(dir);
    const xlsx = join(dir, "stations.xlsx");
    const made = spawnSync("python3", ["-c", [
      "import json, sys, openpyxl",
      "wb = openpyxl.Workbook(); ws = wb.active",
      "for r in json.loads(sys.argv[2]): ws.append(r)",
      "wb.save(sys.argv[1])",
    ].join("\n"), xlsx, JSON.stringify([header, row("가상역", 37.5), row("나상역", 37.5)])], { encoding: "utf8" });
    expect(made.status, made.stderr).toBe(0);
    const out = join(dir, "out.json");
    writeFileSync(out, JSON.stringify([
      { name: "가상역", lineName: "가상선", lat: 37.5, lng: 127.0 },
      { name: "나상역", lineName: "가상선", lat: 37.5, lng: 127.0 },
    ]));
    const r = py(
      [
        "from pathlib import Path",
        "m.OUT = Path(sys.argv[2])",
        "m.ROOT = m.OUT.parent  # 성공 경로의 완료 줄이 OUT을 ROOT 기준 상대 경로로 찍는다",
        'm.COORD_FIXES = {("나상역", "가상선"): (37.501, 127.0)}',
        'sys.argv = ["build-subway-stations.py", sys.argv[1]]',
        "m.main()",
      ].join("\n"),
      [xlsx, out],
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).find((s) => s.name === "나상역").lat).toBe(37.501);
  });
});
