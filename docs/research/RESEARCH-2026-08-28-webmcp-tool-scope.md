# WebMCP 도구 범위 조사 — 전 기능 커버 vs 빈틈 메우기 (2026-08-28)

> 조사 기록물(시점 고정). 결론이 뒤집히면 머리에 한 줄 표기. 판정 결과와 spec 개정은 `docs/superpowers/specs/2026-08-27-webmcp-tool-layer-design.md` §1·§8.5, 열린 항목은 `docs/BACKLOG.md` W1.

## 0. 질문

W1 게이트 3까지 구현된 도구 10개(길찾기 뷰 9 + 홈 1)는 spec §1 "탭이 없으면 못 하는 것만 넣는다"(서버 MCP·CLI가 답하는 조회 20개 제외, 화면에 이미 있는 것 제외)로 선별했다. 쟁점:

- ① WebMCP가 웹앱의 **모든 기능**(AI 채팅·"내 주변" 10섹션·장소 상세·역 정보)을 에이전트가 다루게 도구를 구성하는 것이 바람직한가
- ② 초기 설계대로 **빈틈만** 메우는 구성이 바람직한가
- 위원장 우려: 에이전트가 도구 목록만 보고 답하면 화면을 훑을 때보다 **더 좁은 기능만** 안내받는다.
- 전제: 브라우저 에이전트(ChatGPT 내장 브라우저)는 로컬 stdio 서버 MCP를 못 쓴다 → "서버 MCP가 답한다"는 근거가 같은 세션 안에서 성립하지 않는다.

## 1. 출처별 원문 (fetch 2026-08-28, `defuddle`·raw GitHub·WebSearch)

### 1.1 Chrome 공식 문서

**https://developer.chrome.com/docs/ai/webmcp/best-practices** (유일하게 도구 수·범위를 직접 다루는 페이지)

> "Each tool should consist of a single function. … Be careful not to create overlapping tools, as the agent may be confused as to what to use. Ask yourself: can I cover multiple tasks with the same function?"

> "While there isn't a maximum number of tools allowed, each tool takes up part of the context window and adds to the time for completion. The more tools you provide and the more the tools have overlap, the harder it is for the agent to pick correctly. Experiment to determine what's right for your application."

> "Reduce complexity: For most applications, static registration should be the default approach."

> "Trust the agent to complete the task. Instead of writing rigid or negative instructions, assume the agent is able to understand what is required to complete the task"

> "When writing tool names, distinguish execution from initiation … `create-event` is a tool for immediate event creation, but `start-event-creation-process` is a tool that redirects the user to a form to create the event."

> "A clear description should describe what the tool does and when to use it. Rely on positive language and preferences instead of negative language, such as limitations."

**https://developer.chrome.com/docs/ai/webmcp/secure-tools**

> "500 characters per tool description / 150 characters per parameter description / 30 characters per tool name and parameter name / 1.5K character limit per individual tool output"

**https://developer.chrome.com/blog/webmcp-mcp-usage** (MCP와 WebMCP 역할 분담)

> "Manage core logic with MCP: Your MCP server acts as a foundational service layer. … Build a contextual UI with WebMCP: WebMCP is the final step, a connection for agents directly to your website. It's designed for contextual, in-browser interactions"

> "WebMCP provides a high-fidelity way for a browser-based AI agent to interact with the specific world the user sees in their tab."

**https://developer.chrome.com/docs/ai/webmcp**

> "WebMCP offers higher accuracy for agentic task completion, and it can be added as a progressive enhancement."

Chrome 문서는 "전 기능을 노출하라"도 "부분만 노출하라"도 말하지 않는다. 사용 사례 서술은 일관되게 과업 단위(폼·날짜 선택·체크아웃·`filter_results`)이고 "progressive enhancement"다. **도구가 없을 때 에이전트가 화면으로 폴백하는가에 대한 계약은 침묵**.

### 1.2 W3C WebML CG 제안 (https://github.com/webmachinelearning/webmcp)

README:

> "Page UI and content remain available to the agent for actuation, but the agent can use WebMCP tools to achieve the user's goals more directly, reliably, and quickly, as the tools are in a format more suited to the agent."

> "If an agent or assistive tool finds that the task it is trying to accomplish is not achievable through the WebMCP tools that the page provides, then it can fall back to general-purpose browser automation to try and accomplish its task."

> "Replacement of human interfaces: The human web interface remains primary; agent tools augment rather than replace user interaction."

> "Code reuse: Any task that a user can accomplish through a page's UI can be turned into a tool by reusing much of the page's existing client-side code."

> (Gerrit 사례) "The interface is complex, but the page registers helpful tools to inspect trybot statuses and retrieve logs, perfect for agents that … may otherwise do a poor job actuating such complicated interfaces."

유지관리자 domfarolino, issue #141 ("Composite Tools", 제안자가 "one tool per user intent, ~20-30 tools per site"를 기본으로 하자고 한 데 대해):

> "This is for the developer to figure out, just like it is for skill authors and prompt engineers to figure out the best way to add context to the model"

issue #255 (open):

> "As the tool list grows, the accuracy of the model selection will decrease. This was a well-documented failure mode for large flat tool lists in backend MCP"

issue #144, Chrome chrishtr(선언형 vs 명령형):

> "WebMCP tools that don't need a UI flow with the user can and probably should use the imperative version."

스펙의 유일한 수치는 tool `name` 128자. 도구 개수·범위 지시 없음. `docs/explainer.md`·`docs/proposal.md`는 존재하지 않음(NOT FETCHED).

### 1.3 OpenAI WebMCP Challenge · ChatGPT 내장 브라우저

**https://webmcp.devpost.com/rules** 심사 기준(동일 가중 4항, 동점 시 1항 우선):

> "1. WebMCP Leverage: How thoroughly and skillfully does the project use WebMCP? Does the code reflect genuine effort and a working, non-trivial implementation?"
> "2. Execution: … a complete, coherent product experience — not just a technical proof of concept?"
> "3. Potential Impact: … a credible, specific case for solving a real problem for a real audience"
> "4. Creativity & Ambition"

> "Pre-existing Projects will be evaluated only on work added during the Submission Period." / "Judges may test WebMCP tools using ChatGPT's in-app browser or Google Chrome with WebMCP enabled." / "Judges are not required to test the Project"

마감: "September 3rd, 2026 (1:00 pm Pacific Time)" = 2026-09-04 05:00 KST. ⚠ **갱신 2026-09-04: 12시간 연장돼 09-04 01:00 PT = 09-04 17:00 KST가 됐다**(OpenAI 측 장애, 주최 측 공지 "Deadline Extension | 12 more hours"). 위 인용은 조사 시점(08-28) 그대로이고 규정 페이지 산문은 지금도 원 마감을 들고 있다 — **정본은 Devpost 마감 필드**(`datetime="2026-09-04T04:00:00-04:00"`)다.

**https://learn.chatgpt.com/docs/webmcp** (ChatGPT "Site tools")

> "If no suitable tool is available, the agent may still be able to use its regular browser capabilities."

> "Model Context Protocol (MCP) connects an AI application to a local or remote server. Its tools can work independently of an open webpage … A plugin with an MCP server can provide an integration that works independently of an open page. A website can support both."

> "Start with an operation your application already supports. … Keep inputs narrow, describe side effects, and return enough information to verify the result. … Preserve the normal interface for people and browsers that don't support WebMCP."

> "In the built-in browser, each tool invocation receives a safety review before it runs. Normal website-access and confirmation policies still apply"

OpenAI 자체 문서 사이트의 도구는 5개(`search_openai_docs`·`lookup_page`·`lookup_context`·`navigate_to_page`·`generate_custom_guide`). 내장 브라우저에서 사이트가 부를 수 있는 것은 site tools뿐이고 MCP는 별도 플러그인 경로다(**stdio 서버는 어디에도 등장하지 않음** — 전제 확인). 접근성 언급은 어느 공식 페이지에도 0건.

### 1.4 MCP 일반 도구 설계 지침

**Anthropic, https://www.anthropic.com/engineering/writing-tools-for-agents**

> "We recommend building a few thoughtful tools targeting specific high-impact workflows, which match your evaluation tasks and scaling up from there."

> "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies."

> "Tools should enable agents to subdivide and solve tasks in much the same way that a human would"

**Anthropic, https://www.anthropic.com/engineering/advanced-tool-use** (실측)

> "The most common failures are wrong tool selection and incorrect parameters, especially when tools have similar names"

> "Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool Search Tool enabled." (전체 라이브러리 대신 관련 3~5개만 볼 때)

**Claude 플랫폼 문서, https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use**

> "Consolidate related operations into fewer tools. … Fewer, more capable tools reduce selection ambiguity"

**OpenAI, https://platform.openai.com/docs/guides/function-calling**

> "Aim for fewer than 20 functions available at the start of a turn at any one time, though this is just a soft suggestion."

> "Combine functions that are always called in sequence."

MCP 스펙(2025-06-18)은 도구 수에 침묵. `description`은 "hint", annotations는 신뢰 불가 hint, 사람이 거부할 수 있어야 함(SHOULD).

### 1.5 실제 적용 사례

| 사이트 | 도구 수 | 범위 | 출처 |
|---|---|---|---|
| Shopify Liquid 스토어 전부(2026-08-21 발효) | 10 | 구매 퍼널 전체(검색→상세→장바구니→결제 진입→주문→FAQ). 데이터 반환 기본, `navigate=true`일 때만 이동 | https://shopify.dev/docs/api/web-mcp |
| OpenAI 문서 사이트 | 5 | 검색·읽기·이동·가이드 생성 | https://learn.chatgpt.com/docs/webmcp |
| webmcp.com 디렉터리 359사이트 분포 | 대형 브랜드 1~10, SaaS·데모 20~51 | 1개짜리는 `site_info`·`navigate_by_use_case` 단일 진입점. 디렉터리 자체는 `record_unsupported_request`("Last-resort fallback … helps the maintainers decide which tool to build next") 보유 | https://webmcp.com/ |
| GoogleChromeLabs/webmcp-tools 데모 13종 | 1~13 (소스 카운트) | 데모마다 한 과업 흐름 | https://github.com/GoogleChromeLabs/webmcp-tools |
| sdras/webmcp-demo | 3 | 예약 위젯 조회·생성·취소 | https://github.com/sdras/webmcp-demo |
| vietanh.dev | 3 | 읽기 전용, 쓰기 의도적 제외: "Expose the narrowest tools you can" | https://www.vietanh.dev/blog/2026-07-06-webmcp-agent-ready-website |
| chudi.dev | 3 | "Not every possible action — just the three that answer what an AI agent actually needs." | dev.to |

폴백 명문화 2곳: ChatGPT 문서(위) + Cloudflare Browser Run 에이전트 지침 "Fall back to DOM interaction only when no relevant WebMCP tools exist"(https://developers.cloudflare.com/browser-run/features/webmcp/). 단 **"도구가 일부만 있을 때 에이전트가 실제로 DOM으로 우회했다"는 1차 실측 리포트는 없다** — 소비 에이전트가 Gemini in Chrome(미국 유료)·ChatGPT 데스크톱뿐이라 관측 창이 좁다. Devpost 갤러리는 마감 전이라 미공개.

## 2. 종합 (중립)

1. **"전 기능 노출"을 권하는 출처는 하나도 없다.** Chrome은 범위에 침묵하되 도구마다 컨텍스트 비용·겹침 비용을 명시하고, Anthropic·OpenAI는 소수 고가치 도구(<20)·통합을 권한다. 실배포는 브랜드 1~10개, 범위는 "핵심 과업 흐름"이다.
2. **폴백은 표준 제안·ChatGPT 공식 문서 양쪽에 명문화**돼 있다: 도구로 안 되면 에이전트가 페이지를 직접 다룬다. 위원장 우려("도구 목록만 보고 좁게 안내")는 문서상으로는 부정되지만 **실측 근거는 부재**하며, 우리 실기기 게이트가 그 관측을 직접 해야 한다.
3. **spec §1의 "서버 MCP가 답한다" 근거는 ChatGPT 세션 안에서 성립하지 않는다**(MCP는 별도 플러그인 경로, stdio 미지원). 그러나 그 근거를 빼도 결론은 같은 방향이다 — 빼야 할 것은 "다른 제품이 답하는가"라는 축이고, 남는 축은 Chrome 문구 그대로 **"에이전트가 화면을 직접 다루면 잘 못하는 것"**(복잡 UI·브라우저 안 상태·커서 이동)이다.
4. **"앱이 무엇을 할 수 있는지" 알리는 단일 진입 도구**(webmcp.com `site_info`·`navigate_by_use_case`, OpenAI `navigate_to_page`, Shopify `browse_store`)는 실배포 선례가 있다. Chrome 규칙("실행 vs 개시 구분", 긍정 서술)과도 맞다.
5. 챌린지 심사는 도구 수가 아니라 "thoroughly and skillfully"·"complete, coherent product experience"·"real problem for a real audience"를 본다. 접근성은 심사 기준에 없으므로 제출물이 스스로 그 논거를 세워야 한다.
6. 현재 길동무 상태: 홈 1개, 길찾기 뷰 9개, **"내 주변"·장소 상세·채팅 0개**. 홈에서 "근처 지하철역"을 물으면 에이전트는 도구 없이 허브 뷰를 훑어야 한다(폴백 계약대로라면 동작하지만 미검증).
