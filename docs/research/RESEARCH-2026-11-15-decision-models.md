# 결정 모델(Decision API) 조사와 길동무 적용 검토

2026-11-15 조사. 출처는 뉴스·블로그 2차 자료이고 벤더 공식 문서와 실호출로는 확인하지 않았다. 붙이기 전에 공식 API 문서·가격표와 실호출로 다시 확인한다.

## 무엇인가

글을 쓰지 않고 **정해진 선택지에서 고르거나 점수를 매기는** 모델이다. 요청마다 질문과 허용 답(예·아니오, 선택지 목록, 점수 범위)을 주면 답 하나와 확신도를 돌려준다. 분류·라우팅·채점·검수용이다.

| 이름 | 회사 | 시기 | 알려진 특징 |
|---|---|---|---|
| Jev | TypeSafe AI | 2026-09-15 제한 공개 | 「System One」 모델을 표방. 70~500ms, 입력 100만 토큰당 $0.042, 출력 무과금(회사 발표). 글만 받음. Vercel 유료 팀 35%가 2주 안에 사용(Vercel 게이트웨이 기준) |
| Decisions API | OpenAI (GPT-6 Luna 기반) | 2026-10 제한 공개 → 공개 베타 | 글·이미지. 데모에서 요청당 150ms(Responses API 1.6초 대비, 회사 수치) |
| Gemini Decisions API (Gemini Decision 1) | Google | 2026-11-11 | 한 요청에 질문 최대 1,000개를 글·이미지·소리·영상·PDF에 걸쳐 채점. 답마다 확신도 0~1. 입력 100만 토큰당 $0.10, 출력 무과금. v1beta, AI Studio 무료 등급 있음. 독립 지수(Artificial Analysis Decision Index v2.1) 18개 중 9위 |
| Strands Decider | Amazon | (같은 시기) | 자체 인프라에서 돌릴 수 있다고 보도 |

## 길동무에서 LLM이 고르는 자리와 적용 판단

| 자리 | 판단 | 이유 |
|---|---|---|
| 검색창에서 질문 종류 가르기 | **쓰지 않는다** | 2026-06-27 폐기한 검색 라우터와 같은 자리다. 카카오 검색이 자연어를 이미 처리하는데 그 앞에 분류를 얹어 결과가 나빠졌다 |
| 채팅의 도구 고르기 | **쓰지 않는다** | 도구 선택에는 인자(장소 이름·수단·출발지)가 따라와 고르기만으로 끝나지 않는다. 지금 모델이 고르고 채우는 일을 한 번에 한다 |
| 먼저 말해 주기·횡단보도 경고 | **쓰지 않는다** | 앱의 결정론 규칙이 정본이다. 모델 판단에 묶지 않는 것이 설계 원칙이다 |
| 카메라로 신호등 색·차량 접근 판단 | **쓰지 않는다** | 틀리면 다치는 판단은 카메라 단계에서도 맡기지 않기로 했다(E82 제안 ⓖ) |
| **평가의 날조 채점 보조** | **후보 1순위** | 채점기는 낱말 대조라 다른 회사 모델의 말투를 날조로 잘못 셌다(2026-11-14). 「이 문장이 도구 결과에 근거하는가」를 예·아니오와 확신도로 물어 사람이 읽을 답을 추리는 두 번째 의견으로 쓸 수 있다. 평가 때만 돌고 사용자 데이터가 없으며, Gemini 키를 그대로 쓴다. 단 채점기를 대신하지 않고, 사람 판정과 맞는지 먼저 잰다 |
| 베르길리우스 실시간 음성 단계: 이 말이 나에게 한 말인가 | **후보 2순위** | 마이크가 열려 있을 때 옆 사람과의 대화·안내 음성·VoiceOver를 걸러야 한다. 결정 모델의 짧은 지연이 맞는 자리다. 실시간 음성 단계를 설계할 때 본다 |
| 장소 분류 정리(빌드 때 한 번) | 후보 3순위 | 카카오·네이버 분류 문자열을 묶어 말하기용 종류로 나누는 일을 빌드 때 일괄로 하고 결과를 고정하면 실행 중 비용·지연이 없다. 지금 매핑이 모자라다는 실측이 있을 때만 |

## 결론

지금 사용자에게 닿는 자리에는 넣지 않는다. 길동무의 사실은 앱과 도구가 만들고 모델은 옮기는 자리에 있어, 「빠르게 고르기」가 필요한 곳이 대부분 결정론으로 이미 풀려 있다. 쓸모가 분명한 곳은 평가 채점의 두 번째 의견이고, 12월 재측정(E86) 때 같은 원자료로 사람 판정과의 일치를 재 보면 비용이 몇 센트로 판정이 난다.

## 출처

- [Jev (AI model), Wikipedia](https://en.wikipedia.org/wiki/Jev_(AI_model))
- [TechCrunch: A new kind of AI model from a ChatGPT inventor is thrilling developers](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/)
- [TechCrunch: Jev is Vercel's fastest-adopted AI model ever](https://techcrunch.com/2026/10/16/jev-is-vercels-fastest-adopted-ai-model-ever/)
- [Hugging Face: OpenAI Decisions API vs. Jev](https://huggingface.co/blog/a2aprotocol/openai-decisions-api-vs-jev-a-practical-guide)
- [Firecrawl: OpenAI's Decisions API vs Jev](https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev)
- [VentureBeat: Google's Gemini Decision 1](https://venturebeat.com/technology/googles-gemini-decision-1-model-scores-up-to-1-000-questions-in-one-api-call)
- [MarkTechPost: Google Gemini Decisions API](https://www.marktechpost.com/2026/11/11/google-gemini-decisions-api-gemini-decision-1/)
- [eesel.ai: Gemini Decisions API vs OpenAI and Jev](https://www.eesel.ai/blog/gemini-decisions-api)
