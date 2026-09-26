import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CorpusMissError,
  corpusDirProblem,
  openCorpus,
  parseCorpusArgs,
  requestKey,
  storableOdsayBody,
} from "../odsay-corpus.mjs";

const ODSAY = "https://api.odsay.com/v1/api/searchPubTransPathT";
const always = () => true;
const dirs = [];
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "odsay-corpus-test-"));
  dirs.push(d);
  return d;
}
const restores = [];
afterEach(() => {
  while (restores.length) restores.pop()();
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("requestKey", () => {
  it("파라미터 순서와 apiKey 값에 무관하게 같은 요청은 같은 키", () => {
    const a = requestKey(`${ODSAY}?SX=127.1&SY=37.5&EX=127.0&EY=37.4&OPT=0&apiKey=AAA`);
    const b = requestKey(`${ODSAY}?OPT=0&EY=37.4&EX=127.0&SY=37.5&SX=127.1&apiKey=BBB%2F`);
    expect(a).toBe(b);
    expect(a).toBe("searchPubTransPathT__EX=127.0__EY=37.4__OPT=0__SX=127.1__SY=37.5");
    expect(a).not.toMatch(/apiKey/);
  });

  it("파라미터가 하나라도 다르면 다른 키(수단 재조회·lang)", () => {
    const base = `${ODSAY}?SX=127.1&SY=37.5&EX=127.0&EY=37.4&OPT=0`;
    const keys = new Set([base, `${base}&SearchPathType=1`, `${base}&SearchPathType=2`, `${base}&lang=1`].map(requestKey));
    expect(keys.size).toBe(4);
  });
});

describe("fetchOrReplay", () => {
  it("오프라인에서 없는 키는 호출 없이 null이고 파일을 만들지 않는다", async () => {
    const dir = tempDir();
    const corpus = openCorpus({ dir, offline: true, shouldStore: always });
    const doFetch = vi.fn();
    expect(await corpus.fetchOrReplay("k", doFetch)).toBeNull();
    expect(doFetch).not.toHaveBeenCalled();
    expect(corpus.stats.missed).toEqual(["k"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("저장 모드는 한 번 부르고 저장하며, 같은 키는 다시 부르지 않고 재생한다", async () => {
    const dir = tempDir();
    const corpus = openCorpus({ dir, offline: false, shouldStore: always });
    const doFetch = vi.fn(async () => ({ result: { path: [1] } }));
    expect(await corpus.fetchOrReplay("k", doFetch)).toEqual({ result: { path: [1] } });
    expect(await corpus.fetchOrReplay("k", doFetch)).toEqual({ result: { path: [1] } });
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual(["k.json"]);
    // 같은 디렉터리를 오프라인으로 열면 호출 없이 읽힌다
    const replay = openCorpus({ dir, offline: true, shouldStore: always });
    expect(await replay.fetchOrReplay("k", vi.fn())).toEqual({ result: { path: [1] } });
    expect(replay.stats).toMatchObject({ replayed: 1, fetched: 0, missed: [] });
  });

  it("저장 술어가 거절한 응답은 돌려주되 저장하지 않는다(오류 봉투)", async () => {
    const dir = tempDir();
    const shouldStore = storableOdsayBody({
      readOdsayError: (raw) => (raw ? { code: String((Array.isArray(raw) ? raw[0] : raw).code) } : null),
      isNoRouteError: (code) => code === "-98",
    });
    const corpus = openCorpus({ dir, offline: false, shouldStore });
    const authFail = { error: [{ code: "500", message: "[ApiKeyAuthFailed]" }] };
    expect(await corpus.fetchOrReplay("auth", async () => authFail)).toEqual(authFail);
    await corpus.fetchOrReplay("noroute", async () => ({ error: { code: "-98", msg: "700m" } }));
    expect(readdirSync(dir)).toEqual(["noroute.json"]);
  });

  it("doFetch가 throw하면 파일을 만들지 않고 그대로 던진다", async () => {
    const dir = tempDir();
    const corpus = openCorpus({ dir, offline: false, shouldStore: always });
    await expect(corpus.fetchOrReplay("k", async () => { throw new Error("HTTP 500"); })).rejects.toThrow("HTTP 500");
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("openCorpus", () => {
  it("저장소 안 경로는 거절한다(공개 저장소에 응답 dump 금지)", () => {
    const repo = fileURLToPath(new URL("../../..", import.meta.url));
    expect(() => openCorpus({ dir: join(repo, "tmp-corpus"), offline: false, shouldStore: always })).toThrow(/저장소 밖/);
    expect(() => openCorpus({ dir: repo, offline: true, shouldStore: always })).toThrow(/저장소 밖/);
    expect(existsSync(join(repo, "tmp-corpus"))).toBe(false);
  });

  it("저장소 판정은 심링크를 풀고, `..`로 시작하는 이름을 밖으로 오인하지 않는다", () => {
    const repo = fileURLToPath(new URL("../../..", import.meta.url));
    const link = join(tempDir(), "link-to-repo");
    symlinkSync(repo, link);
    expect(corpusDirProblem(join(link, "x"), false)).toMatch(/저장소 밖/);
    expect(corpusDirProblem(join(repo, "..x"), false)).toMatch(/저장소 밖/);
    expect(corpusDirProblem(join(tempDir(), "ok"), false)).toBeNull();
  });

  it("오프라인에서 디렉터리가 없으면 빈 corpus로 위장하지 않고 던진다", () => {
    expect(() => openCorpus({ dir: join(tempDir(), "nope"), offline: true, shouldStore: always })).toThrow(/디렉터리가 없다/);
  });

  it("저장 술어는 기본값이 없다", () => {
    expect(() => openCorpus({ dir: tempDir(), offline: false })).toThrow(/shouldStore/);
  });
});

describe("installFetch", () => {
  const saved = globalThis.fetch;
  function install(corpus, original) {
    globalThis.fetch = original;
    const restore = corpus.installFetch();
    restores.push(() => {
      restore();
      globalThis.fetch = saved;
    });
  }

  it("오프라인: 없는 ODsay 요청은 원래 fetch를 부르지 않고 CorpusMissError", async () => {
    const corpus = openCorpus({ dir: tempDir(), offline: true, shouldStore: always });
    const original = vi.fn();
    install(corpus, original);
    await expect(fetch(`${ODSAY}?SX=1&apiKey=x`)).rejects.toBeInstanceOf(CorpusMissError);
    expect(original).not.toHaveBeenCalled();
    expect(corpus.stats.missed).toHaveLength(1);
  });

  it("ODsay 밖 호스트는 그대로 통과한다", async () => {
    const corpus = openCorpus({ dir: tempDir(), offline: true, shouldStore: always });
    const original = vi.fn(async () => new Response("ok"));
    install(corpus, original);
    expect(await (await fetch("http://swopenapi.seoul.go.kr/x")).text()).toBe("ok");
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("저장 모드: 200 JSON은 저장하고 재호출은 재생, 비-2xx는 원 응답 그대로·미저장", async () => {
    const dir = tempDir();
    const corpus = openCorpus({ dir, offline: false, shouldStore: always });
    // 실패 응답 본문도 JSON이다 — `res.ok` 분기가 없으면 JSON 파싱이 통과해 저장되는 변이를 잡는다.
    const original = vi.fn(async (url) =>
      String(url).includes("SX=9")
        ? new Response(JSON.stringify({ error: "down" }), { status: 503 })
        : new Response(JSON.stringify({ result: 1 })),
    );
    install(corpus, original);
    const url = `${ODSAY}?SX=1&apiKey=k`;
    expect(await (await fetch(url)).json()).toEqual({ result: 1 });
    expect(await (await fetch(`${ODSAY}?apiKey=other&SX=1`)).json()).toEqual({ result: 1 });
    expect(original).toHaveBeenCalledTimes(1);
    const failed = await fetch(`${ODSAY}?SX=9&apiKey=k`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "down" });
    expect(readdirSync(dir)).toEqual(["searchPubTransPathT__SX=1.json"]);
  });

  it("같은 요청이 동시에 오면 원래 fetch는 한 번이고, 실패 원문도 각자 받는다", async () => {
    const dir = tempDir();
    const corpus = openCorpus({ dir, offline: false, shouldStore: always });
    let release;
    const gate = new Promise((r) => { release = r; });
    const original = vi.fn(async () => { await gate; return new Response("busy", { status: 500 }); });
    install(corpus, original);
    const both = Promise.all([fetch(new URL(`${ODSAY}?SX=1`)), fetch(new Request(`${ODSAY}?SX=1&apiKey=z`))]);
    release();
    const [a, b] = await both;
    expect(original).toHaveBeenCalledTimes(1);
    expect([await a.text(), await b.text()]).toEqual(["busy", "busy"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("되돌리면 원래 fetch로 돌아간다", () => {
    const corpus = openCorpus({ dir: tempDir(), offline: true, shouldStore: always });
    const original = vi.fn();
    globalThis.fetch = original;
    const restore = corpus.installFetch();
    expect(globalThis.fetch).not.toBe(original);
    restore();
    expect(globalThis.fetch).toBe(original);
    globalThis.fetch = saved;
  });

  it("JSON이 아닌 200 응답도 저장하지 않고 원문 그대로 돌려준다", async () => {
    const dir = tempDir();
    const corpus = openCorpus({ dir, offline: false, shouldStore: always });
    install(corpus, vi.fn(async () => new Response("<html>")));
    expect(await (await fetch(`${ODSAY}?SX=1`)).text()).toBe("<html>");
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("parseCorpusArgs", () => {
  it("--out과 --from-corpus 중 정확히 하나", () => {
    expect(parseCorpusArgs(["--out", "/x"])).toEqual({ dir: "/x", offline: false });
    expect(parseCorpusArgs(["--from-corpus", "/y"])).toEqual({ dir: "/y", offline: true });
    expect(() => parseCorpusArgs([])).toThrow(/하나만/);
    expect(() => parseCorpusArgs(["--out", "/x", "--from-corpus", "/y"])).toThrow(/하나만/);
    expect(() => parseCorpusArgs(["--out"])).toThrow(/값 없음/);
    expect(() => parseCorpusArgs(["--ledger", "/z"])).toThrow(/모르는 인자/);
  });
});
