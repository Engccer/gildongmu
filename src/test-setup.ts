/**
 * Vitest 공용 셋업.
 *
 * ⚠ **jsdom 환경에 `localStorage`가 전역으로 노출되지 않는다.** vitest가
 * jsdom 창의 속성을 전역으로 복사할 때 `Storage`·`StorageEvent` **생성자**만
 * 목록에 있고 `localStorage` **인스턴스**는 빠져 있다(실측 vitest 4.1·jsdom 29).
 * 창 자체(`globalThis.jsdom.window`)에는 정상적인 Storage가 있으므로, 스텁을
 * 만들지 않고 그 실제 구현을 전역·window에 연결한다.
 *
 * node 환경 테스트에서는 `globalThis.jsdom`이 없어 아무 일도 하지 않는다.
 */
const dom = (globalThis as { jsdom?: { window: Window & typeof globalThis } }).jsdom;

if (dom && typeof (globalThis as { localStorage?: Storage }).localStorage === "undefined") {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    const storage = dom.window[key];
    if (!storage) continue;
    Object.defineProperty(globalThis, key, {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}
