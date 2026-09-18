import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/verify-briefing-station-join.mjs");
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// 실제 응답을 복사하지 않은 합성 표본. 네 경로에 이름이 들리는 줄 20개가 있다.
function corpus(lang = "ko") {
  const subway = (fromName, toName) => ({
    mode: "subway", minutes: 2, lineName: "2호선", fromName, toName,
    stops: [fromName, toName].map((name) => ({ name, lat: 37.5, lng: 127 })),
  });
  return {
    lang, capturedAt: "2026-09-18T01:02:03.000Z",
    samples: [{ pair: "부산 합성 표본", routes: Array.from({ length: 4 }, () => ({ legs: [
      { mode: "walk", minutes: 1, toName: "가상승차" },
      subway("가상승차", "가상환승"), subway("가상환승", "가상하차"),
      { mode: "bus", minutes: 3, fromName: "가상정류장", toName: "가상종점" },
    ] })) }],
  };
}

function harness(value = corpus(), { live = false, quotaAt = 1, quotaKind = false, swiftFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "briefing-corpus-test-"));
  dirs.push(dir);
  const input = join(dir, "saved corpus ' 한글.json");
  const audit = join(dir, "audit.jsonl");
  const preload = join(dir, "guard.mjs");
  writeFileSync(input, typeof value === "string" ? value : JSON.stringify(value));
  writeFileSync(audit, "");
  // 프로세스 경계에서 env 파일 접근·번들·네트워크를 검출한다. Swift만 대역으로 바꿔
  // CLI 배선/실패 전파를 검사하고, 실제 Kit 실행은 별도 집중 검증으로 수행한다.
  writeFileSync(preload, `
    import fs from 'node:fs';
    import cp from 'node:child_process';
    import http from 'node:http';
    import https from 'node:https';
    import net from 'node:net';
    import { syncBuiltinESMExports, registerHooks } from 'node:module';
    const audit = ${JSON.stringify(audit)};
    const record = (event) => fs.appendFileSync(audit, JSON.stringify(event) + '\\n');
    const deny = (kind) => { record({ forbidden: kind }); process.exit(90); };
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (String(path).includes('.env')) {
        record({ envRead: true });
        if (!${live}) deny('env');
      }
      return read(path, ...args);
    };
    const write = fs.writeFileSync;
    fs.writeFileSync = (...args) => {
      // appendFileSync도 내부에서 writeFileSync를 쓰므로 검사자의 감사 로그만 허용한다.
      if (!${live} && args[0] !== audit) deny('file write');
      return write(...args);
    };
    registerHooks({ resolve(specifier, context, next) {
      if (/providers|odsay\\.mjs|esbuild|briefing-station-join-live/.test(specifier) && !${live}) deny('provider import');
      return next(specifier, context);
    }});
    globalThis.fetch = () => deny('fetch');
    for (const obj of [http, https]) {
      obj.request = obj.get = () => deny('http');
    }
    net.connect = net.createConnection = net.Socket.prototype.connect = () => deny('socket');
    cp.execFileSync = (file, args, options) => {
      record({ command: file, args, corpus: options?.env?.BRIEFING_JOIN_GATE });
      if (file === 'swift') {
        if (${swiftFails}) throw Object.assign(new Error('synthetic Kit failure'), { status: 1 });
        return Buffer.from('');
      }
      if (file !== 'npx' || !${live}) deny('bundle/process');
      const output = args.find(a => a.startsWith('--outfile=')).slice('--outfile='.length);
      fs.writeFileSync(output, \`
        import { appendFileSync } from 'node:fs';
        let calls = 0;
        export async function getTransitRoute() {
          appendFileSync(\${JSON.stringify(audit)}, JSON.stringify({ providerCall: ++calls }) + '\\\\n');
          if (calls > ${quotaAt}) throw Object.assign(new Error(${JSON.stringify(quotaKind ? "daily limit" : "HTTP 429")}), ${JSON.stringify(quotaKind ? { kind: "quota" } : {})});
          const routes = \${JSON.stringify(${JSON.stringify(corpus().samples[0].routes)})};
          return { recommended: routes[0], alternatives: routes.slice(1) };
        }
      \`);
      return Buffer.from('');
    };
    syncBuiltinESMExports();
  `);
  return {
    input,
    run(args = ["--from-corpus", input]) {
      const before = readFileSync(input, "utf8");
      const result = spawnSync(process.execPath, ["--import", preload, script, ...args], {
        cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir }, timeout: 20_000,
      });
      expect(result.error).toBeUndefined();
      expect(readFileSync(input, "utf8")).toBe(before);
      const events = readFileSync(audit, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      return { ...result, output: result.stdout + result.stderr, events };
    },
  };
}

describe("저장 브리핑 코퍼스 CLI", () => {
  it.each(["ko", "en"])("%s 저장 시각·언어와 원본 경로를 Kit에 넘기고 env·번들·통신을 하지 않는다", (lang) => {
    const h = harness(corpus(lang));
    const r = h.run();
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("저장 코퍼스 재검증");
    expect(r.output).toContain("2026-09-18T01:02:03.000Z");
    expect(r.output).toContain(`lang=${lang}`);
    expect(r.output).toContain("6/6 PASS");
    expect(r.events).toEqual([{ command: "swift", args: [
      "test", "--package-path", resolve("ios/GildongmuKit"),
      "--disable-automatic-resolution", "--skip-update", "--filter", "BriefingStationJoinGateTests",
    ], corpus: h.input }]);
  });

  it.each([
    ["--from-corpus"], ["--from-corpus", "--lang", "ko"], ["--lang"], ["--out"],
    ["--lang", "ja"], ["--lang", "ko", "--lang", "en"], ["--unknown"], ["extra.json"],
    ["--from-corpus", "a", "--from-corpus", "b"],
  ])("인자 오류를 부작용 전에 거부: %j", (...args) => {
    const r = harness().run(args);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/인자/);
    expect(r.events).toEqual([]);
  });

  it("언어 불일치와 --out 병용을 거부한다", () => {
    for (const extra of [["--lang", "en"], ["--out", "unused.json"]]) {
      const h = harness();
      const r = h.run(["--from-corpus", h.input, ...extra]);
      expect(r.status).toBe(1);
      expect(r.output).toMatch(/언어 불일치|--out/);
      expect(r.events).toEqual([]);
    }
  });

  it("명시한 언어가 저장 언어와 같으면 원본 그대로 검증한다", () => {
    const h = harness(corpus("en"));
    const r = h.run(["--from-corpus", h.input, "--lang", "en"]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("lang=en");
  });

  it("읽을 수 없는 코퍼스를 live로 전환하지 않는다", () => {
    const r = harness().run(["--from-corpus", "/nonexistent/briefing.json"]);
    expect(r.status).toBe(1);
    expect(r.events).toEqual([]);
  });

  it.each([
    "{broken", "null", "[]", {}, { ...corpus(), lang: "ja" },
    { ...corpus(), capturedAt: "today" }, { ...corpus(), capturedAt: "2026-02-30T00:00:00.000Z" },
    { ...corpus(), samples: [] }, { ...corpus(), samples: [{ pair: "빈 표본", routes: [] }] },
    { ...corpus(), samples: [{ pair: "빈 경로", routes: [{ legs: [] }] }] },
    { ...corpus(), samples: [{ pair: "잘못된 구간", routes: [{ legs: [{ mode: "train", minutes: 2 }] }] }] },
    { ...corpus(), samples: [{ pair: "잘못된 구간", routes: [{ legs: [{ mode: "walk" }] }] }] },
  ])("형식 오류나 빈 표본을 통과시키지 않는다: %#", (value) => {
    const r = harness(value).run();
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/코퍼스/);
    expect(r.events).toEqual([]);
  });

  it("미수집 케이스와 필드 불일치는 Kit 성공으로 가리지 않는다", () => {
    const value = corpus();
    value.samples[0].routes = [{ legs: [
      { mode: "walk", minutes: 1, toName: "다른역" },
      value.samples[0].routes[0].legs[1],
    ] }];
    const r = harness(value).run();
    expect(r.status).toBe(1);
    expect(r.output).toContain("불일치 1");
    expect(r.output).toContain("2/6 PASS");
    expect(r.events).toHaveLength(1);
  });

  it.each(["transfer", "mixed", "adjacent", "city", "walk"])("필요 케이스 %s 미수집을 따로 실패시킨다", (missing) => {
    const value = corpus();
    if (missing === "city") value.samples[0].pair = "서울 합성 표본";
    for (const route of value.samples[0].routes) {
      if (missing === "transfer") {
        route.legs = [route.legs[0], route.legs[1], route.legs[3]];
      } else if (missing === "mixed") {
        route.legs[3] = route.legs[1];
      } else if (missing === "adjacent") {
        route.legs.splice(2, 0, { mode: "walk", minutes: 1, toName: "가상환승" });
      } else if (missing === "walk") {
        route.legs.shift();
      }
    }
    const r = harness(value).run();
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/FAIL:/);
    expect(r.events).toHaveLength(1);
  });

  it("Kit 실패는 표본 6/6 PASS여도 실패다", () => {
    const r = harness(corpus(), { swiftFails: true }).run();
    expect(r.status).toBe(1);
    expect(r.output).toContain("6/6 PASS");
    expect(r.output).toContain("Kit");
  });
});

describe("live 쿼터 회귀 (provider 대역, 실제 API 0)", () => {
  it.each([false, true])("쿼터 즉시 중단·부분 수집 보존: kind=%s", (quotaKind) => {
    const h = harness(corpus(), { live: true, quotaAt: 7, quotaKind });
    const out = join(h.input, "..", "partial.json");
    const r = h.run(["--out", out, "--lang", "en"]);
    expect(r.status, r.output).toBe(2);
    expect(r.events.filter(e => e.providerCall)).toHaveLength(8);
    expect(r.events.some(e => e.command === "swift")).toBe(false);
    const dump = JSON.parse(readFileSync(out, "utf8"));
    expect(dump.lang).toBe("en");
    expect(dump.samples).toHaveLength(7);
    expect(Number.isFinite(Date.parse(dump.capturedAt))).toBe(true);
  });

  it("첫 호출 쿼터도 재시도 없이 exit 2", () => {
    const r = harness(corpus(), { live: true, quotaAt: 0 }).run([]);
    expect(r.status).toBe(2);
    expect(r.events.filter(e => e.providerCall)).toHaveLength(1);
  });

  it("쿼터 전에 모은 불충분한 표본도 저장하고 기존 exit 1을 유지한다", () => {
    const h = harness(corpus(), { live: true, quotaAt: 1 });
    const out = join(h.input, "..", "incomplete.json");
    const r = h.run(["--out", out]);
    expect(r.status).toBe(1);
    expect(r.events.filter(e => e.providerCall)).toHaveLength(2);
    expect(JSON.parse(readFileSync(out, "utf8")).samples).toHaveLength(1);
    expect(r.output).toContain("쿼터로 표본 절단");
  });
});
