#!/usr/bin/env node
// D35 Cache Components 득실 실측 — 두 빌드(기준·후보)를 같은 조건으로 띄워 비교한다.
// 설계·판정 기준은 spec `docs/superpowers/specs/2026-10-27-cache-components-experiment-design.md`.
//
//   node scripts/cache-components-measure/measure.mjs --baseline <빌드된 저장소 디렉터리> \
//     --candidate <빌드된 저장소 디렉터리> [--runs 15] [--out <결과 JSON>]
//
// 각 디렉터리는 `next build`가 끝난 상태여야 한다(이 스크립트는 빌드하지 않는다 — 빌드 로그의 라우트 표는
// 별도 산출물이다). 실호출 0: 서버는 더미 키 + `upstream-stub.mjs`, 브라우저는 localhost 밖을 끊고
// `/api/**`를 빈 fixture로 받는다(첫 화면 뼈대만 잰다 — 데이터가 채워진 화면은 범위 밖, spec §3).

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const runs = Number(args.runs ?? 15);
const variants = { baseline: args.baseline, candidate: args.candidate };
for (const [k, v] of Object.entries(variants)) {
  if (!v || !existsSync(join(v, ".next", "BUILD_ID"))) {
    console.error(`--${k}: 빌드된 저장소 디렉터리가 아니다(${v ?? "미지정"} — .next/BUILD_ID 없음)`);
    process.exit(2);
  }
}

// playwright.config.ts GATE_KEYS와 같은 더미 키 — 게이트를 전부 켠 같은 화면을 두 빌드에서 만든다.
const DUMMY_KEYS = [
  "KAKAO_REST_API_KEY", "NAVER_LOCAL_CLIENT_ID", "NAVER_LOCAL_CLIENT_SECRET", "NCP_MAPS_CLIENT_ID",
  "NCP_MAPS_CLIENT_SECRET", "TOUR_API_KEY", "DATA_GO_KR_API_KEY", "DEEPGRAM_API_KEY", "SEOUL_OPEN_DATA_KEY",
  "SEOUL_SUBWAY_REALTIME_KEY", "ODSAY_API_KEY", "JUSO_CONFM_KEY", "TMAP_APP_KEY", "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY", "GOOGLE_CLOUD_TTS_API_KEY", "GOOGLE_PLACES_API_KEY",
];

const PAGES = ["/ko", "/en", "/ko/about"];

// 캐시 검사: 같은 요청을 REPEAT번 보내고 upstream 호출 수를 센다.
// - places: 카카오 `next.revalidate: 300` → 기대 1회(캐시가 살아 있으면). 늘어나면 비용·쿼터 회귀다.
// - subway-arrival: `no-store` 실시간 → 기대 REPEAT회. 줄어들면 낡은 도착 정보 회귀다.
const REPEAT = 5;
const CACHE_PROBES = [
  // 검색어에 실행마다 다른 꼬리를 단다 — `.next/cache/fetch-cache`는 디스크에 남아 앞 실행의 응답이 300초 안에
  // 다시 쓰이면 0회로 나온다(첫 시험 실행에서 실제로 그랬다). 새 키라야 "1회 뒤 캐시"를 잰다.
  { name: "places(카카오 revalidate 300)", path: `/api/places?query=${encodeURIComponent(`카페${process.pid}${Date.now()}`)}&lat=37.5796&lng=126.9770`, host: "dapi.kakao.com", expect: 1 },
  { name: "subway-arrival(no-store 실시간)", path: "/api/station/subway-arrival?station=%EA%B4%91%ED%99%94%EB%AC%B8", host: "swopenapi.seoul.go.kr", expect: REPEAT },
];

function startServer(dir, port, countFile) {
  const env = { ...process.env, PORT: String(port), UPSTREAM_COUNT_FILE: countFile, NODE_ENV: "production" };
  for (const k of DUMMY_KEYS) env[k] = "measure-dummy";
  delete env.PLACES_PROVIDER;
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import ${join(here, "upstream-stub.mjs")}`.trim();
  const child = spawn(join(dir, "node_modules", ".bin", "next"), ["start", "-p", String(port)], {
    cwd: dir, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

async function waitReady(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/robots.txt`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`port ${port} 서버가 60초 안에 뜨지 않았다`);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function measurePage(browser, origin, path) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    // 매 회 새 컨텍스트 = 빈 캐시(첫 방문). 서비스 워커는 막는다(a11y 게이트와 같은 격리).
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    let bytes = 0;
    // 압축·chunked 응답은 content-length가 없어 본문 크기를 요청 단위로 센다(압축 해제 뒤 바이트).
    page.on("requestfinished", async (req) => {
      bytes += (await req.sizes()).responseBodySize;
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "localhost") return route.abort();
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 502, json: { error: "측정(D35)" } });
      return route.continue();
    });
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.goto(origin + path, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        ttfb: nav.responseStart,
        dcl: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
        fcp: fcp ? fcp.startTime : null,
        lcp: window.__lcp || null,
        htmlBytes: nav.encodedBodySize,
        // 첫 낭독 순서의 대리 지표: 하이드레이션 뒤 접근성 트리의 앞부분(헤딩·랜드마크 순서가 같으면 같다고 본다).
        headings: [...document.querySelectorAll("h1,h2,h3,main,nav,header,[role=status]")].slice(0, 12)
          .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent ?? "").trim().slice(0, 30)}`),
      };
    });
    samples.push({ ...m, transferBytes: bytes });
    await ctx.close();
  }
  const pick = (k) => median(samples.map((s) => s[k]).filter((x) => x != null));
  return {
    runs,
    medianMs: { ttfb: pick("ttfb"), fcp: pick("fcp"), lcp: pick("lcp"), dcl: pick("dcl"), load: pick("load") },
    htmlBytes: pick("htmlBytes"),
    transferBytes: pick("transferBytes"),
    outline: samples[0]?.headings ?? [],
  };
}

async function probeCache(origin, countFile) {
  const out = [];
  for (const p of CACHE_PROBES) {
    const before = existsSync(countFile) ? JSON.parse(readFileSync(countFile, "utf8"))[p.host] ?? 0 : 0;
    const statuses = [];
    for (let i = 0; i < REPEAT; i++) statuses.push((await fetch(origin + p.path)).status);
    await new Promise((r) => setTimeout(r, 200));
    const after = existsSync(countFile) ? JSON.parse(readFileSync(countFile, "utf8"))[p.host] ?? 0 : 0;
    out.push({ name: p.name, requests: REPEAT, upstreamCalls: after - before, expect: p.expect, ok: after - before === p.expect, statuses });
  }
  return out;
}

function staticBytes(dir) {
  const root = join(dir, ".next", "static");
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (f.endsWith(".js")) total += st.size;
    }
  };
  walk(root);
  return total;
}

const result = {};
const browser = await chromium.launch();
let port = 3210;
try {
  for (const [name, dir] of Object.entries(variants)) {
    const work = mkdtempSync(join(tmpdir(), `d35-${name}-`));
    const countFile = join(work, "upstream.json");
    const server = startServer(resolve(dir), port, countFile);
    try {
      await waitReady(port);
      const origin = `http://localhost:${port}`;
      const pages = {};
      for (const p of PAGES) pages[p] = await measurePage(browser, origin, p);
      result[name] = { dir: resolve(dir), staticJsBytes: staticBytes(dir), pages, cache: await probeCache(origin, countFile) };
    } catch (e) {
      console.error(server.log());
      throw e;
    } finally {
      server.child.kill("SIGTERM");
      port += 1;
    }
  }
} finally {
  await browser.close();
}

// 첫 낭독 순서 대리 지표가 두 빌드에서 같은가(헤딩·랜드마크 앞 12개).
result.outlineSame = Object.fromEntries(
  PAGES.map((p) => [p, JSON.stringify(result.baseline.pages[p].outline) === JSON.stringify(result.candidate.pages[p].outline)]),
);

const json = JSON.stringify(result, null, 2);
if (args.out) writeFileSync(args.out, json);
console.log(json);
const cacheBroken = Object.keys(variants).some((k) => result[k].cache.some((c) => !c.ok));
process.exit(cacheBroken ? 1 : 0);
