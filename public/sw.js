// 길동무 수제 서비스워커 (Serwist가 Turbopack 빌드와 비호환이라 폴백 경로 채택).
// 정책: 페이지(document)는 network-first → 실패 시 로케일별 오프라인 폴백.
// API(/api/*)는 절대 캐시하지 않는다(실데이터 원칙, 가짜 캐시 금지) — fetch 처리에서 early-return.
const SHELL = "gildongmu-shell-v2";
// 로케일 분리(/ko·/en)가 이 앱의 핵심 가치이므로 오프라인 폴백도 로케일별로 둔다.
const OFFLINE_KO = "/ko/offline";
const OFFLINE_EN = "/en/offline";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([OFFLINE_KO, OFFLINE_EN])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // 이전 버전 셸 캐시 정리.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 동일 출처가 아니면 SW가 개입하지 않는다(외부 API/지도 타일 등).
  if (url.origin !== self.location.origin) return;
  // API 비캐시(실데이터): 가로채지 않고 브라우저 기본 네트워크에 맡긴다.
  if (url.pathname.startsWith("/api/")) return;
  if (req.destination === "document") {
    // 요청 로케일로 폴백 선택(/en이면 영어, 아니면 한국어).
    const offlineUrl = url.pathname.startsWith("/en") ? OFFLINE_EN : OFFLINE_KO;
    // 페이지: network-first → 로케일별 오프라인 폴백.
    e.respondWith(
      fetch(req).catch(
        async () =>
          (await caches.match(offlineUrl)) ??
          new Response("", { status: 503, statusText: "Offline" }),
      ),
    );
  }
});
