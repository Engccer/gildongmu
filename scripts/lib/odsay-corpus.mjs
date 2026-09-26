// ODsay 실호출 게이트의 저장 응답(corpus) 규약 한 곳(E47-1). ODsay Flex는 호출당 과금이라 개발·검증 호출이 곧 비용이다.
//
// 규약(선례 `verify-odsay-alternatives.mjs`에서 뽑았다):
//   - 요청 하나 = 파일 하나(`<key>.json`, 원시 응답 본문 그대로). 키는 결정론이다 — 같은 요청은 같은 파일.
//   - 저장 모드(`--out <dir>`): 파일이 있으면 다시 부르지 않고 읽는다(재실행 = 재사용). 없으면 한 번 부르고 저장한다.
//   - 실패 응답(HTTP 비-2xx·JSON 아님·저장 술어가 거절한 오류 봉투)은 저장하지 않는다. 저장하면 이후 재생이 영영 그
//     오류를 사실로 읽는다(무효 키·쿼터 초과도 HTTP 200 + error 봉투다).
//   - 오프라인 모드(`--from-corpus <dir>`): 원본 읽기 전용, 호출 0. 없는 파일은 호출 없이 "없음"(null)이다.
//   - corpus는 저장소 밖(`~/gildongmu-private/probes/<스크립트>-<YYYY-MM-DD>/`)에 둔다 — 공개 저장소라 응답 dump를
//     커밋하지 않는다. 저장소 안 경로는 거절한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const ODSAY_HOST = "api.odsay.com";

/** 오프라인 재생에서 provider 키 게이트만 통과시키는 자리 표시. 가로채기가 새도 upstream은 인증 실패로 끝난다. */
export const OFFLINE_KEY_PLACEHOLDER = "corpus-replay-no-key";

/** 오프라인 재생에 없는 요청이 있었다 — 판정 불가(호출 0). */
export const EXIT_CORPUS_MISS = 3;

/** 인자 오류. 게이트마다 2를 쿼터 소진으로 쓰는 곳이 있어 겹치지 않는 값(sysexits EX_USAGE)을 쓴다. */
export const EXIT_USAGE = 64;

export class CorpusMissError extends Error {
  constructor(key) {
    super(`corpus에 응답 없음: ${key}`);
    this.name = "CorpusMissError";
    this.key = key;
  }
}

/**
 * ODsay 요청 URL → corpus 키. 엔드포인트 + 파라미터 정렬(apiKey 제외)이라 파라미터 순서·키 값과 무관하게 같다.
 * 예: `searchPubTransPathT__EX=127.0276__EY=37.4979__OPT=0__SX=127.1408__SY=37.5384`
 */
export function requestKey(url) {
  const u = new URL(url);
  const endpoint = u.pathname.split("/").filter(Boolean).pop() ?? "root";
  const params = [...u.searchParams]
    .filter(([k]) => k !== "apiKey")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .sort();
  return [endpoint, ...params].join("__");
}

/**
 * ODsay 응답 저장 술어. 판정은 provider의 봉투 판독을 그대로 쓴다(복제 금지) — 번들한 `readOdsayError`·`isNoRouteError`를
 * 넘긴다. 오류 봉투 없음 또는 "경로 없음"류만 사실로 저장한다.
 */
export function storableOdsayBody({ readOdsayError, isNoRouteError }) {
  return (body) => {
    const err = readOdsayError(body?.error);
    return !err || isNoRouteError(err.code);
  };
}

/**
 * @param {{ dir: string, offline: boolean, shouldStore: (body: unknown) => boolean }} opts
 *   shouldStore는 기본값이 없다 — 빠뜨리면 오류 봉투가 corpus에 남는 조용한 결함이 된다.
 */
export function openCorpus({ dir, offline, shouldStore }) {
  if (!dir) throw new Error("corpus 디렉터리가 필요하다");
  if (typeof offline !== "boolean") throw new Error("offline은 true/false로 명시한다");
  if (typeof shouldStore !== "function") throw new Error("shouldStore(저장 술어)가 필요하다");
  const root = resolve(dir);
  const rel = relative(REPO_ROOT, root);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(`corpus는 저장소 밖에 둔다(공개 저장소): ${root}`);
  }
  if (offline && !existsSync(root)) throw new Error(`corpus 디렉터리가 없다: ${root}`);
  if (!offline) mkdirSync(root, { recursive: true });

  const stats = { replayed: 0, fetched: 0, stored: 0, missed: [] };
  const fileOf = (key) => join(root, `${key}.json`);

  const corpus = {
    dir: root,
    offline,
    stats,
    has: (key) => existsSync(fileOf(key)),

    /**
     * 저장본이 있으면 읽고, 없으면 저장 모드에서만 `doFetch()`(본문을 돌려주거나 throw)를 한 번 부르고 저장한다.
     * 오프라인에서 없으면 호출 없이 null. doFetch가 throw하면 아무것도 저장하지 않고 그대로 던진다.
     */
    async fetchOrReplay(key, doFetch) {
      const path = fileOf(key);
      if (existsSync(path)) {
        stats.replayed++;
        return JSON.parse(readFileSync(path, "utf8"));
      }
      if (offline) {
        stats.missed.push(key);
        return null;
      }
      stats.fetched++;
      const body = await doFetch();
      if (shouldStore(body)) {
        writeFileSync(path, JSON.stringify(body));
        stats.stored++;
      }
      return body;
    },

    /**
     * 전역 fetch를 가로채 ODsay 호출만 corpus를 지나게 한다 — provider를 번들해 태우는 게이트가 판정 로직을
     * 바꾸지 않고 같은 규약을 쓰는 자리. ODsay 밖 호스트는 그대로 통과한다. 되돌리는 함수를 반환한다.
     * 오프라인에서 없는 요청은 `CorpusMissError`로 던진다(호출 0).
     */
    installFetch() {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url).hostname !== ODSAY_HOST) return original(input, init);
        const key = requestKey(url);
        let passthrough = null;
        let body;
        try {
          body = await corpus.fetchOrReplay(key, async () => {
            const res = await original(input, init);
            const text = await res.text();
            const failed = () => {
              passthrough = new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
              return new Error("pass-through");
            };
            if (!res.ok) throw failed();
            try {
              return JSON.parse(text);
            } catch {
              throw failed();
            }
          });
        } catch (e) {
          if (passthrough) return passthrough;
          throw e;
        }
        if (body === null) throw new CorpusMissError(key);
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      };
      return () => {
        globalThis.fetch = original;
      };
    },

    summary() {
      return `ODsay corpus ${offline ? "재생" : "저장"}: 재생 ${stats.replayed} · 실호출 ${stats.fetched} · 저장 ${stats.stored} · 없음 ${stats.missed.length} (${root})`;
    },

    /** 오프라인에서 없는 요청이 있었으면 판정 불가로 끝낸다(exit 3). 게이트 판정 출력보다 우선한다. */
    exitIfMissed() {
      if (!offline || stats.missed.length === 0) return;
      console.error(
        `\nNO CORPUS — corpus에 없는 ODsay 요청 ${stats.missed.length}건(호출 0), 판정 불가: ${root}\n` +
          stats.missed.slice(0, 5).map((k) => `  ${k}`).join("\n") +
          "\n  실호출로 채우려면 --out <새 디렉터리>로 돌린다(ODsay Flex 과금 — 예산 확인 먼저).",
      );
      process.exit(EXIT_CORPUS_MISS);
    },
  };
  return corpus;
}

/**
 * provider를 태우는 게이트 공용 인자: `--out <dir>`(실호출 + 저장) 또는 `--from-corpus <dir>`(오프라인, 호출 0) 중
 * 정확히 하나. 저장 없는 실호출 모드는 없다 — 부른 응답은 전부 남긴다.
 * @returns {{ dir: string, offline: boolean }}
 */
export function parseCorpusArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--out", "--from-corpus"].includes(key)) throw new Error(`모르는 인자 ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`${key} 값 없음`);
    opts[key] = value;
  }
  if (Boolean(opts["--out"]) === Boolean(opts["--from-corpus"])) {
    throw new Error("--out <dir>(실호출·저장) 또는 --from-corpus <dir>(오프라인·호출 0) 중 하나만 준다");
  }
  return { dir: opts["--from-corpus"] ?? opts["--out"], offline: Boolean(opts["--from-corpus"]) };
}

/**
 * 게이트 머리에서 `.env.local`을 읽기 **전에** 부른다: 인자를 읽고(틀리면 exit 64), 오프라인이면 ODsay 키 자리에
 * 자리 표시를 먼저 넣어 실제 키가 들어오지 못하게 한다.
 */
export function corpusArgsOrExit(argv) {
  let args;
  try {
    args = parseCorpusArgs(argv);
  } catch (e) {
    console.error(`인자 오류: ${e.message}`);
    process.exit(EXIT_USAGE);
  }
  if (args.offline) process.env.ODSAY_API_KEY = OFFLINE_KEY_PLACEHOLDER;
  return args;
}
