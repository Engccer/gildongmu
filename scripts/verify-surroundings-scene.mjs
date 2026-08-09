#!/usr/bin/env node
/**
 * M1 부근 재구성 실호출 게이트 — dev 서버(localhost:3000)에 5경로 실호출.
 * fixture green ≠ 실계약 검증. 다섯 줄이 모두 예상대로여야 머지 게이트 통과.
 *
 * 사용: `npm run dev` 띄운 뒤 `node scripts/verify-surroundings-scene.mjs`
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const CASES = [
  {
    name: "신명중학교 (골목 — juso 건물로 축이 서야 한다)",
    lat: 37.5415,
    lng: 127.1495,
    check(body) {
      const s = body.data;
      if (!s) return "data 없음";
      if (s.frame !== "entrance") return `frame=${s.frame} (entrance 기대)`;
      const right = s.groups.find((g) => g.bucket === "right");
      const found = right?.items.some((i) => i.name.includes("신명초"));
      return found ? null : "신명초가 오른쪽 묶음에 없음";
    },
  },
  {
    name: "강동구청 (성내로 홀수 — 짝수 상가가 맞은편이어야 한다)",
    lat: 37.5301,
    lng: 127.1237,
    check(body) {
      const s = body.data;
      if (!s) return "data 없음";
      if (s.frame !== "entrance") return `frame=${s.frame} (entrance 기대)`;
      const across = s.groups.find((g) => g.bucket === "across");
      return across && across.items.length > 0 ? null : "맞은편 묶음이 비어 있음";
    },
  },
  {
    name: "자택 (봉래면옥 왼쪽 · 세븐일레븐 오른쪽/건물 너머)",
    lat: 37.5366,
    lng: 127.1473,
    check(body) {
      const s = body.data;
      if (!s) return "data 없음";
      if (s.frame !== "entrance") return `frame=${s.frame} (entrance 기대)`;
      const bucketOf = (needle) => {
        for (const g of s.groups) {
          if (g.items.some((i) => i.name.includes(needle))) return g.bucket;
        }
        return null;
      };
      const bong = bucketOf("봉래면옥");
      const seven = bucketOf("세븐일레븐");
      const errs = [];
      if (bong !== "left") errs.push(`봉래면옥=${bong} (left 기대)`);
      if (seven !== "right" && seven !== "beyond")
        errs.push(`세븐일레븐=${seven} (right/beyond 기대)`);
      return errs.length ? errs.join(", ") : null;
    },
  },
  {
    // 좌표는 카카오 키워드 실측(2026-08-10) — 시장 내부라 역지오코딩 도로명이 없다.
    // ⚠ 근사 좌표를 쓰면 도로 매핑점에 얹혀 entrance로 새는 것을 실측으로 확인했다.
    name: "망원시장 (도로명주소 없음 — compass 폴백)",
    lat: 37.555886,
    lng: 126.906266,
    check(body) {
      const s = body.data;
      if (!s) return "data 없음";
      return s.frame === "compass" ? null : `frame=${s.frame} (compass 기대)`;
    },
  },
  {
    // 비수도권 + 일반구 보유 시(행정 depth가 서울과 다름) — juso 키워드 조립이
    // 시도·시군구 조각으로 성립하는지. 수원시청(효원로 241, 홀수).
    name: "수원시청 (비수도권 행정 depth — 축 성립)",
    lat: 37.2636,
    lng: 127.0286,
    check(body) {
      const s = body.data;
      if (!s) return "data 없음";
      return s.frame === "entrance" ? null : `frame=${s.frame} (entrance 기대)`;
    },
  },
  {
    name: "해외 좌표 파리 (outOfCoverage)",
    lat: 48.85,
    lng: 2.35,
    check(body) {
      return body.outOfCoverage === true ? null : "outOfCoverage 마커 없음";
    },
  },
];

let pass = 0;
for (const c of CASES) {
  const url = `${BASE}/api/surroundings/scene?lat=${c.lat}&lng=${c.lng}`;
  let verdict;
  let extra = "";
  try {
    const res = await fetch(url);
    const body = await res.json();
    verdict = c.check(body, res);
    if (body.data) {
      const counts = body.data.groups
        .map((g) => `${g.bucket}:${g.items.length}`)
        .join(" ");
      extra = `  frame=${body.data.frame} total=${body.data.total}  ${counts}`;
    }
  } catch (e) {
    verdict = `호출 실패: ${e.message}`;
  }
  if (verdict === null) {
    pass += 1;
    console.log(`✓ ${c.name}${extra}`);
  } else {
    console.log(`✗ ${c.name} — ${verdict}${extra}`);
  }
}
console.log(`\n${pass}/${CASES.length} 통과`);
process.exit(pass === CASES.length ? 0 : 1);
