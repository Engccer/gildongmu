#!/usr/bin/env node
// 역 전화번호 게이트(E44 spec §8)의 기대표 작성용 원본 덤프. 입력 역마다 /api/places 응답의 역·출구 POI를
// 사람이 읽을 수 있게 한 줄씩 찍는다(이름 | 분류 끝 조각 | 번호 | 입력 좌표에서의 거리 m). 판정 규칙을 흉내 내지 않는다.
// 사용: node scripts/dump-station-pois.mjs <inputs.json> [baseUrl] > dump.txt
import { readFileSync } from "node:fs";

const [inputsPath, base = "https://gildongmu.dodoplanet.space"] = process.argv.slice(2);
if (!inputsPath) {
  console.error("사용: node scripts/dump-station-pois.mjs <inputs.json> [baseUrl]");
  process.exit(1);
}
const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));
const meters = (a, b, c, d) => {
  const r = Math.PI / 180, R = 6371000;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
};
for (const [i, s] of inputs.entries()) {
  const query = `${s.name.replace(/\([^)]*\)/g, "").trim().replace(/역$/, "")}역`;
  const url = `${base}/api/places?query=${encodeURIComponent(query)}&lat=${s.lat}&lng=${s.lng}&lang=ko`;
  let body;
  for (let attempt = 0; attempt < 2 && !body; attempt++) {
    try {
      const res = await fetch(url);
      body = res.ok ? await res.json() : { error: res.status };
    } catch (e) {
      if (attempt === 1) body = { error: String(e) };
    }
  }
  console.log(`## ${i} ${s.name} · ${s.lineName} (${s.lat}, ${s.lng}) query=${query}`);
  if (body.error) {
    console.log(`  ERROR ${body.error}`);
  } else {
    for (const p of body.places ?? []) {
      if (!/지하철|전철|기차/.test(p.category)) continue;
      const tail = p.category.split(">").map((x) => x.trim()).pop();
      console.log(`  ${p.name} | ${tail} | ${p.phone ?? "-"} | ${meters(s.lat, s.lng, p.lat, p.lng)}m | ${p.id}`);
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}
