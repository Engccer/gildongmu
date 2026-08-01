/**
 * App Store Connect 제출 자동화 (REST API).
 *
 * 브라우저 로그인 없이 버전 생성 → 릴리스 노트 입력 → 빌드 연결 → 심사 제출까지
 * 수행한다. 종전 절차는 ASC 웹 폼을 JS 네이티브 setter로 조작해야 했고(React가
 * 프로그래매틱 입력을 되돌린다), 세션이 만료되면 사람이 로그인해야 멈췄다.
 *
 * ## 사전 준비 (1회, 위원장 직접)
 *
 * ASC > Users and Access > Integrations > App Store Connect API > Team Keys >
 * Generate API Key. 권한은 **App Manager** 이상.
 *   - 내려받은 `AuthKey_XXXXXXXXXX.p8`를 `~/.appstoreconnect/private_keys/`에 둔다
 *     (파일명 그대로. 이 경로는 xcodebuild·altool도 자동으로 찾는다).
 *   - Key ID(10자)와 Issuer ID(UUID)를 아래 env로 넘긴다.
 * ⚠ .p8는 재다운로드가 불가능하다. 분실하면 키를 폐기하고 새로 만들어야 한다.
 *
 * ## 사용
 *
 *   export ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-...
 *   node ios/scripts/asc-submit.mjs --version 1.3 --build 9 \
 *     --notes-ko docs/appstore/notes/1.3-ko.txt \
 *     --notes-en docs/appstore/notes/1.3-en.txt
 *
 * 기본은 **드라이런**이다(무엇을 바꿀지만 출력). 실제 반영은 `--apply`,
 * 심사 제출까지는 `--apply --submit`. 제출은 되돌리기 어려우므로 두 플래그를
 * 분리했다 — `--apply`만으로는 초안까지만 만들어지고 제출되지 않는다.
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE_ID = "space.dodoplanet.gildongmu";
const BASE = "https://api.appstoreconnect.apple.com/v1";
const PLATFORM = "IOS";
/** ko는 ASC에서 `ko`, 영어는 `en-US`. 웹 로케일 코드와 다르니 여기서 못 박는다. */
const LOCALES = { ko: "ko", en: "en-US" };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const SUBMIT = has("submit");
const CHECK = has("check");

const KEY_DIR = join(homedir(), ".appstoreconnect", "private_keys");

/**
 * 자격 증명 해석. env가 우선이고, 없으면 저장소 `.env.local`(gitignore 대상)을
 * 읽는다 — 매번 export하지 않게 하려는 것이고, 이 파일은 이미 다른 키들이
 * 사는 곳이라 새 관리 지점을 만들지 않는다.
 *
 * Key ID는 파일명(`AuthKey_XXXXXXXXXX.p8`)에서 유일하게 유도되므로, 키가
 * 한 개뿐이면 `ASC_KEY_ID`도 생략할 수 있다. 사람이 옮겨 적을 값을 줄이면
 * 오타로 실패하는 경로가 그만큼 줄어든다.
 */
function credentials() {
  const env = { ...process.env };
  const local = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), ".env.local");
  if (existsSync(local)) {
    for (const line of readFileSync(local, "utf8").split("\n")) {
      const m = /^(ASC_KEY_ID|ASC_ISSUER_ID|ASC_KEY_PATH)=(.+)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  let keyId = env.ASC_KEY_ID;
  let keyPath = env.ASC_KEY_PATH;
  if (!keyPath && existsSync(KEY_DIR)) {
    const keys = readdirSync(KEY_DIR).filter((f) => /^AuthKey_.+\.p8$/.test(f));
    if (!keyId && keys.length === 1) keyId = keys[0].slice(8, -3);
    if (keyId) {
      const guess = join(KEY_DIR, `AuthKey_${keyId}.p8`);
      if (existsSync(guess)) keyPath = guess;
    }
  }
  return { keyId, issuerId: env.ASC_ISSUER_ID, keyPath, keysSeen: existsSync(KEY_DIR) ? readdirSync(KEY_DIR).filter((f) => f.endsWith(".p8")) : [] };
}

/** ES256 JWT. Node의 `ieee-p1363` 인코딩이 JOSE 형식과 같아 DER 변환이 불필요하다. */
function makeToken(keyId, issuerId, privateKey, nowSec) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "ES256", kid: keyId, typ: "JWT" });
  // exp는 20분 이내여야 한다(Apple 제약). 여유를 두고 15분.
  const payload = b64({
    iss: issuerId,
    iat: nowSec,
    exp: nowSec + 15 * 60,
    aud: "appstoreconnect-v1",
  });
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${sig.toString("base64url")}`;
}

let TOKEN;
async function api(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ASC가 JSON이 아닌 본문을 주면 원문을 보여 준다(원인 없는 SyntaxError 방지).
    throw new Error(`${method} ${path} → 비-JSON 응답 ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.title}: ${e.detail}`).join(" / ") ?? text.slice(0, 300);
    throw new Error(`${method} ${path} → ${res.status} ${detail}`);
  }
  return json;
}

function step(msg) {
  console.log(`  ${APPLY ? "▶" : "·"} ${msg}`);
}

/** 자격 증명이 준비됐는지 사람이 읽을 수 있게 진단한다(무엇이 없는지까지). */
function setupHelp({ keyId, issuerId, keyPath, keysSeen }) {
  const lines = ["자격 증명이 준비되지 않았다.", ""];
  lines.push(`  .p8 위치   ${KEY_DIR}`);
  lines.push(`  발견된 키  ${keysSeen.length ? keysSeen.join(", ") : "(없음)"}`);
  lines.push(`  Key ID     ${keyId ?? "(미설정)"}`);
  lines.push(`  Issuer ID  ${issuerId ?? "(미설정)"}`);
  if (!keysSeen.length) {
    lines.push("", "① ASC > Users and Access > Integrations > App Store Connect API >");
    lines.push("   Team Keys > Generate API Key (권한 App Manager 이상)");
    lines.push(`② 내려받은 AuthKey_*.p8를 ${KEY_DIR}/ 에 둔다 (.p8는 재다운로드 불가)`);
  }
  if (!issuerId) {
    lines.push("", "③ 저장소 .env.local에 아래 한 줄을 추가한다(Key ID는 파일명에서 자동 인식):");
    lines.push("   ASC_ISSUER_ID=<ASC의 Issuer ID(UUID)>");
  }
  lines.push("", "준비되면 검증: node ios/scripts/asc-submit.mjs --check");
  return lines.join("\n");
}

async function main() {
  const cred = credentials();
  if (!cred.keyId || !cred.issuerId || !cred.keyPath) {
    throw new Error(setupHelp(cred));
  }
  TOKEN = makeToken(cred.keyId, cred.issuerId, readFileSync(cred.keyPath, "utf8"), Math.floor(Date.now() / 1000));

  if (CHECK) {
    const app = (await api("GET", `/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
    if (!app) throw new Error(`인증은 됐으나 앱을 못 찾음: ${BUNDLE_ID} (키 권한 확인)`);
    const vs = (await api("GET", `/apps/${app.id}/appStoreVersions?limit=3`)).data;
    const bs = (await api("GET", `/builds?filter[app]=${app.id}&limit=3`)).data;
    console.log(`\n인증 성공 — ${app.attributes.name} (${app.id})`);
    console.log(`  키       ${cred.keyId} (${cred.keyPath})`);
    console.log(`  최근 버전 ${vs.map((v) => `${v.attributes.versionString} ${v.attributes.appStoreState}`).join(" · ")}`);
    console.log(`  최근 빌드 ${bs.map((b) => `${b.attributes.version} ${b.attributes.processingState}`).join(" · ")}\n`);
    return;
  }

  const version = arg("version");
  const buildNumber = arg("build");
  if (!version || !buildNumber) {
    throw new Error("사용법: --check | --version 1.3 --build 9 [--notes-ko FILE --notes-en FILE] [--apply [--submit]]");
  }

  const notes = {};
  for (const [k, file] of [["ko", arg("notes-ko")], ["en", arg("notes-en")]]) {
    if (file) notes[k] = readFileSync(file, "utf8").trim();
  }

  console.log(`\n[${APPLY ? (SUBMIT ? "APPLY+SUBMIT" : "APPLY") : "DRY RUN"}] 버전 ${version} / 빌드 ${buildNumber}\n`);

  const app = (await api("GET", `/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) throw new Error(`앱을 찾지 못함: ${BUNDLE_ID}`);
  console.log(`앱: ${app.attributes.name} (${app.id})`);

  // 1) 버전 초안 확보
  const existing = (
    await api("GET", `/apps/${app.id}/appStoreVersions?filter[versionString]=${version}&limit=1`)
  ).data[0];
  let versionId = existing?.id;
  if (existing) {
    console.log(`버전 ${version} 이미 존재 (${existing.attributes.appStoreState})`);
  } else {
    step(`버전 ${version} 생성`);
    if (APPLY) {
      const created = await api("POST", "/appStoreVersions", {
        data: {
          type: "appStoreVersions",
          attributes: { platform: PLATFORM, versionString: version },
          relationships: { app: { data: { type: "apps", id: app.id } } },
        },
      });
      versionId = created.data.id;
    }
  }

  // 2) 릴리스 노트. ⚠ 새 버전 초안은 프로모션 텍스트를 승계하지 않으므로
  //    whatsNew만 쓰고 나머지는 건드리지 않는다(빈 값 덮어쓰기 사고 방지).
  if (versionId && Object.keys(notes).length) {
    const locs = (await api("GET", `/appStoreVersions/${versionId}/appStoreVersionLocalizations`)).data;
    for (const [key, text] of Object.entries(notes)) {
      const want = LOCALES[key];
      const loc = locs.find((l) => l.attributes.locale === want);
      if (!loc) {
        console.log(`  ⚠ 로케일 ${want} 없음 — 건너뜀(ASC에서 먼저 추가할 것)`);
        continue;
      }
      const promo = loc.attributes.promotionalText;
      if (!promo) {
        console.log(`  ⚠ ${want} 프로모션 텍스트가 비어 있다 — 새 버전은 이 값을 승계하지 않는다. 별도 입력 필요`);
      }
      step(`${want} What's New ${text.length}자 기록`);
      if (APPLY) {
        await api("PATCH", `/appStoreVersionLocalizations/${loc.id}`, {
          data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: { whatsNew: text } },
        });
      }
    }
  }

  // 3) 빌드 연결
  const build = (
    await api(
      "GET",
      `/builds?filter[app]=${app.id}&filter[version]=${buildNumber}&filter[preReleaseVersion.version]=${version}.0&limit=1`,
    )
  ).data[0] ??
    (await api("GET", `/builds?filter[app]=${app.id}&filter[version]=${buildNumber}&limit=1`)).data[0];
  if (!build) throw new Error(`빌드 ${buildNumber}를 찾지 못함(업로드·처리 완료 확인)`);
  console.log(`빌드: ${buildNumber} (${build.attributes.processingState})`);
  if (build.attributes.processingState !== "VALID") {
    throw new Error(`빌드 처리 미완료: ${build.attributes.processingState}`);
  }
  if (versionId) {
    step("버전에 빌드 연결");
    if (APPLY) {
      await api("PATCH", `/appStoreVersions/${versionId}/relationships/build`, {
        data: { type: "builds", id: build.id },
      });
    }
  }

  // 4) 심사 제출. 되돌리기 어려우므로 --submit을 따로 요구한다.
  if (!SUBMIT) {
    console.log("\n제출은 하지 않았다(--submit 미지정). 초안 상태로 남는다.\n");
    return;
  }
  if (!APPLY) {
    console.log("\n드라이런이라 제출하지 않는다. 실제 제출은 --apply --submit.\n");
    return;
  }
  step("reviewSubmission 생성");
  const sub = await api("POST", "/reviewSubmissions", {
    data: {
      type: "reviewSubmissions",
      attributes: { platform: PLATFORM },
      relationships: { app: { data: { type: "apps", id: app.id } } },
    },
  });
  step("버전을 제출 항목으로 추가");
  await api("POST", "/reviewSubmissionItems", {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: sub.data.id } },
        appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
      },
    },
  });
  step("심사 제출");
  await api("PATCH", `/reviewSubmissions/${sub.data.id}`, {
    data: { type: "reviewSubmissions", id: sub.data.id, attributes: { submitted: true } },
  });
  console.log("\n제출 완료. 최대 48시간 내 심사 결과 이메일.\n");
}

main().catch((e) => {
  console.error(`\n실패: ${e.message}\n`);
  process.exit(1);
});
