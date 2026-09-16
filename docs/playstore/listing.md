# Google Play 스토어 등재 초안 (O3)

> **초안** — 문안은 위원장 왕복(TextEdit) 대상이다. 확정 전에는 어떤 값도 Play Console에 입력하지 않는다. iOS 정본 `docs/appstore/1.0-submission-draft.md`(§1~§6·§10)를 안드로이드 사정에 맞게 옮겼다. 안드로이드 전용 차이: 스크린 리더는 TalkBack·한소네(키보드·점자 단말기), 받아쓰기는 Android 13+ 온디바이스 인식기가 있는 기기에서만, 도보 실시간 안내는 실험판 봉인(정식판 미노출).

## 1. 앱 정보

| 항목 | 값 | 비고 |
|---|---|---|
| 앱 이름(30자) | 길동무: 접근성 길찾기 | iOS 스토어 이름 "길동무: 텍스트 기반 접근성 길찾기 앱"은 30자 초과 |
| 패키지 이름 | `space.dodoplanet.gildongmu` | 실험판 `.dev`는 스토어에 올리지 않는다 |
| 기본 언어 | 한국어(ko-KR) | |
| 카테고리 | 지도/내비게이션 | iOS 기본 카테고리 내비게이션·보조 여행 |
| 태그 | 내비게이션, 접근성, 대중교통, 여행 | Play는 최대 5개 |
| 가격 | 무료, 인앱결제 없음, 광고 없음 | |
| 개인정보 처리방침 URL | https://gildongmu.dodoplanet.space/ko/privacy | Play Console 필수 |
| 지원 이메일 | engccer@gmail.com | Play Console 필수 |
| 웹사이트 | https://gildongmu.dodoplanet.space | |
| 개발자 이름 | Hunyong Kim | |

## 2. 짧은 설명 (80자)

- ko: `스크린 리더로 완전히 접근 가능한 대한민국 길찾기 앱`
- en: `A Korean navigation app fully usable with a screen reader`
- es: `App de navegación para Corea totalmente accesible con lector de pantalla`
- fr: `Une app de navigation en Corée entièrement accessible au lecteur d'écran`
- it: `App di navigazione per la Corea completamente accessibile con screen reader`
- ja: `スクリーンリーダーだけで使える韓国のナビゲーションアプリ`

## 3. 자세한 설명 (4000자) — ko

```
길동무는 스크린 리더 사용자를 1차 사용자로 설계한 대한민국 길찾기 앱입니다. 검색부터 장소 정보, 경로 안내까지 전체 흐름이 TalkBack과 점자 단말기로 접근 가능합니다.

주요 기능
- 장소·주소 검색: 카카오·네이버 기반 정확도순 결과, 분류·지역 필터
- 경로: 출발지와 도착지 지정, 대중교통·자동차·도보 경로를 텍스트로 확인
- 내 주변: 지하철 실시간 도착, 버스 도착, 따릉이, 소아 야간진료, 아이 놀 곳, 무장애 관광지, 문화행사, 보행 인프라, 둘러보기
- 역 정보: 역 시설과 엘리베이터·음성유도기 위치, 첫차·막차 시간과 실시간 도착
- 현재 위치: 지금 있는 곳과 주변 상황을 문장으로 설명, 원하는 장소를 현재 위치로 지정
- 날씨: 실시간 날씨와 대기질, 혼잡도
- AI 채팅: 장소, 경로 등 길찾기에 필요한 정보를 자연어로 질문, 출처와 함께 답변
- 받아쓰기: 온디바이스 음성 인식(지원 기기), 탭으로 시작하고 정지하는 방식과 누르고 있는 동안 녹음하는 방식 선택 가능

접근성 설계 원칙
- 모든 정보는 텍스트와 목록으로 표시되며, 한 줄이 한 개의 접근성 객체가 되도록 화면을 구조화했습니다
- 헤딩 탐색으로 결과·대화를 빠르게 건너뛸 수 있습니다
- 화면이 바뀔 때 커서가 다음에 할 일이 있는 자리에 놓입니다
- "0건", "정보 없음", "조회 실패"를 구분해 알려 줍니다
- 한국어·영어·스페인어·프랑스어·이탈리아어·일본어를 지원합니다

서비스 지역
- 위치 기반 기능(내 주변, 날씨, 현재 위치)은 대한민국 안에서 제공됩니다. 장소 검색, 역 정보, 길찾기, AI 채팅은 해외에서도 사용할 수 있습니다

개인정보 보호
- 계정과 로그인이 없으며, 자체 서버에 개인정보를 저장하지 않습니다
- 채팅 기록은 서버에 저장하지 않으며, 받아쓰기 음성은 기기 밖으로 나가지 않습니다
```

## 4. 자세한 설명 — en

```
Gildongmu is a Korean navigation app designed with screen-reader users as its primary users. The entire flow, from search to place details to route guidance, is fully accessible with TalkBack and braille displays.

Features
- Place and address search: accuracy-first results with category and region filters
- Routes: set your origin and destination, then compare transit and driving routes as plain text
- Nearby: real-time subway and bus arrivals, bike share, night clinics, kid-friendly places, barrier-free attractions, cultural events, walking infrastructure, surroundings
- Station info: facilities, elevator and audio-beacon locations, first and last train times, real-time arrivals
- Current location: where you are and what is around you, in plain sentences; set any place as your current location
- Weather: current weather, air quality, and crowding
- AI chat: ask about places and routes in natural language, with sources for every answer
- Dictation: on-device speech recognition (supported devices), tap-to-toggle or hold-to-talk

Accessibility principles
- Everything is text and lists, structured so each line is one accessible object
- Heading navigation lets you jump through results and conversations
- When a screen changes, the cursor lands where the next action is
- "None found", "no information", and "lookup failed" are always told apart
- Available in Korean, English, Spanish, French, Italian, and Japanese

Service region
- Location-based features (Nearby, Weather, Current location) are available within South Korea. Place search, station info, directions, and AI chat work from anywhere

Privacy
- No account, no sign-in, and no personal data stored on our servers
- Chat history is never stored on our servers, and dictation audio never leaves your device
```

## 5. 자세한 설명 — es · fr · it · ja (초안, en 미러)

es:
```
Gildongmu es una app de navegación para Corea diseñada con los usuarios de lector de pantalla como usuarios principales. Todo el flujo, desde la búsqueda hasta los detalles del lugar y la guía de rutas, es accesible con TalkBack y líneas braille.

Funciones
- Búsqueda de lugares y direcciones: resultados por precisión con filtros de categoría y región
- Rutas: elige origen y destino y compara transporte público y coche en texto
- Cerca de mí: llegadas de metro y autobús en tiempo real, bicicletas compartidas, clínicas nocturnas, lugares para niños, atracciones sin barreras, eventos culturales, infraestructura peatonal, alrededores
- Información de estaciones: instalaciones, ascensores y balizas sonoras, primer y último tren, llegadas en tiempo real
- Ubicación actual: dónde estás y qué hay alrededor, en frases; fija cualquier lugar como tu ubicación actual
- Tiempo: tiempo actual, calidad del aire y aglomeración
- Chat con IA: pregunta sobre lugares y rutas en lenguaje natural, con fuentes en cada respuesta
- Dictado: reconocimiento de voz en el dispositivo (dispositivos compatibles), por toque o manteniendo pulsado

Principios de accesibilidad
- Todo es texto y listas, estructurado para que cada línea sea un objeto accesible
- La navegación por encabezados permite saltar entre resultados y conversaciones
- Al cambiar de pantalla, el cursor se sitúa donde está la siguiente acción
- "Sin resultados", "sin información" y "error de consulta" siempre se distinguen
- Disponible en coreano, inglés, español, francés, italiano y japonés

Región de servicio
- Las funciones basadas en ubicación (Cerca de mí, Tiempo, Ubicación actual) están disponibles dentro de Corea del Sur. La búsqueda de lugares, la información de estaciones, las rutas y el chat con IA funcionan desde cualquier lugar

Privacidad
- Sin cuenta, sin inicio de sesión y sin datos personales almacenados en nuestros servidores
- El historial del chat nunca se guarda en nuestros servidores y el audio del dictado nunca sale de tu dispositivo
```

fr:
```
Gildongmu est une application de navigation en Corée conçue avec les utilisateurs de lecteur d'écran comme premiers utilisateurs. Tout le parcours, de la recherche aux détails d'un lieu et au guidage d'itinéraire, est accessible avec TalkBack et les afficheurs braille.

Fonctions
- Recherche de lieux et d'adresses : résultats par pertinence avec filtres de catégorie et de région
- Itinéraires : choisissez départ et arrivée, puis comparez transports en commun et voiture en texte
- À proximité : arrivées de métro et de bus en temps réel, vélos en libre-service, cliniques de nuit, lieux pour enfants, sites sans obstacles, événements culturels, infrastructures piétonnes, alentours
- Infos gares : équipements, ascenseurs et balises sonores, premier et dernier train, arrivées en temps réel
- Position actuelle : où vous êtes et ce qui vous entoure, en phrases ; définissez n'importe quel lieu comme position actuelle
- Météo : météo actuelle, qualité de l'air et affluence
- Chat IA : posez vos questions sur les lieux et itinéraires en langage naturel, avec les sources de chaque réponse
- Dictée : reconnaissance vocale sur l'appareil (appareils compatibles), par appui simple ou maintenu

Principes d'accessibilité
- Tout est texte et listes, structuré pour que chaque ligne soit un objet accessible
- La navigation par titres permet de sauter entre résultats et conversations
- Quand l'écran change, le curseur se place là où se trouve la prochaine action
- « Aucun résultat », « pas d'information » et « échec de la consultation » sont toujours distingués
- Disponible en coréen, anglais, espagnol, français, italien et japonais

Zone de service
- Les fonctions basées sur la position (À proximité, Météo, Position actuelle) sont disponibles en Corée du Sud. La recherche de lieux, les infos gares, les itinéraires et le chat IA fonctionnent partout

Confidentialité
- Pas de compte, pas de connexion et aucune donnée personnelle stockée sur nos serveurs
- L'historique du chat n'est jamais conservé sur nos serveurs et l'audio de la dictée ne quitte jamais votre appareil
```

it:
```
Gildongmu è un'app di navigazione per la Corea progettata con gli utenti di screen reader come utenti principali. L'intero flusso, dalla ricerca ai dettagli del luogo fino alla guida del percorso, è accessibile con TalkBack e display braille.

Funzioni
- Ricerca di luoghi e indirizzi: risultati per precisione con filtri di categoria e regione
- Percorsi: scegli partenza e arrivo e confronta mezzi pubblici e auto in testo
- Nelle vicinanze: arrivi di metro e bus in tempo reale, bici condivise, cliniche notturne, luoghi per bambini, attrazioni senza barriere, eventi culturali, infrastrutture pedonali, dintorni
- Info stazioni: strutture, ascensori e segnalatori acustici, primo e ultimo treno, arrivi in tempo reale
- Posizione attuale: dove sei e cosa c'è intorno, in frasi; imposta qualsiasi luogo come posizione attuale
- Meteo: meteo attuale, qualità dell'aria e affollamento
- Chat IA: chiedi di luoghi e percorsi in linguaggio naturale, con le fonti di ogni risposta
- Dettatura: riconoscimento vocale sul dispositivo (dispositivi supportati), a tocco o tenendo premuto

Principi di accessibilità
- Tutto è testo ed elenchi, strutturato perché ogni riga sia un oggetto accessibile
- La navigazione per intestazioni consente di saltare tra risultati e conversazioni
- Quando la schermata cambia, il cursore si posiziona dove si trova l'azione successiva
- "Nessun risultato", "nessuna informazione" e "ricerca non riuscita" sono sempre distinti
- Disponibile in coreano, inglese, spagnolo, francese, italiano e giapponese

Area di servizio
- Le funzioni basate sulla posizione (Nelle vicinanze, Meteo, Posizione attuale) sono disponibili in Corea del Sud. Ricerca di luoghi, info stazioni, percorsi e chat IA funzionano ovunque

Privacy
- Nessun account, nessun accesso e nessun dato personale salvato sui nostri server
- La cronologia della chat non viene mai salvata sui nostri server e l'audio della dettatura non lascia mai il dispositivo
```

ja:
```
キルトンムは、スクリーンリーダー利用者を第一の利用者として設計した韓国のナビゲーションアプリです。検索から場所の情報、経路案内まで、すべての流れをTalkBackと点字ディスプレイで操作できます。

主な機能
- 場所・住所検索：精度順の結果、分類・地域フィルター
- 経路：出発地と目的地を指定し、公共交通・自動車の経路をテキストで確認
- 周辺：地下鉄・バスのリアルタイム到着、シェアサイクル、小児夜間診療、子ども向けスポット、バリアフリー観光地、文化イベント、歩行インフラ、周辺の様子
- 駅情報：駅設備、エレベーターと音声誘導装置の位置、始発・終電、リアルタイム到着
- 現在地：今いる場所と周りの様子を文章で説明。任意の場所を現在地として指定可能
- 天気：現在の天気、大気質、混雑度
- AIチャット：場所や経路について自然な言葉で質問し、出典付きで回答
- 音声入力：端末内の音声認識（対応端末）。タップで開始・停止する方式と、押している間だけ録音する方式を選択可能

アクセシビリティの設計原則
- すべての情報はテキストとリストで表示し、1行が1つのアクセシビリティ要素になるよう構成
- 見出しナビゲーションで結果や会話を素早く移動
- 画面が変わると、次に操作する場所にカーソルが移動
- 「0件」「情報なし」「取得失敗」を区別して伝達
- 韓国語・英語・スペイン語・フランス語・イタリア語・日本語に対応

サービス地域
- 位置情報に基づく機能（周辺、天気、現在地）は韓国国内で提供します。場所検索、駅情報、経路、AIチャットは海外でも利用できます

プライバシー
- アカウントもログインもなく、当社サーバーに個人情報を保存しません
- チャット履歴はサーバーに保存せず、音声入力の音声は端末の外に出ません
```

## 6. 콘텐츠 등급 (IARC 설문 답안 초안)

| 질문 | 답 | 근거 |
|---|---|---|
| 폭력·성적 콘텐츠·욕설·공포·도박·약물 | 없음 | iOS 연령 등급 4+ 근거 동일 |
| 사용자 간 상호작용(채팅·공유) | 없음 | AI 채팅은 사용자 간 통신이 아니다 |
| 사용자 생성 콘텐츠 공개 | 없음 | |
| 위치 공유(타인과) | 없음 | 위치는 본인 조회용 |
| 디지털 구매 | 없음 | |
| 무제한 웹 접근 | 없음 | 외부 링크는 처리방침·OSM 저작권·지도 앱 딥링크·메일뿐 |
| AI 생성 콘텐츠 관련 질문(있으면) | 있음 | 채팅 답변이 AI 생성 — 정직 응답 |
| 예상 등급 | 전체 이용가(3+) | |

## 7. 타깃 대상·앱 콘텐츠 선언 초안

- 타깃 연령: 18세 이상(아동 대상 설계 아님 — 가족 정책 비적용).
- 광고: 없음. 뉴스 앱: 아니오. 정부 앱: 아니오. 금융: 아니오. COVID-19: 아니오.
- 건강 관련: 도보 안내 도착 화면의 걸음·칼로리 추정(실험판 봉인)과 설정의 체중 입력 — 정식판 노출 범위를 감사(`data-safety.md`)에서 확정한 뒤 "건강 앱" 선언 여부를 정한다.
- 데이터 안전성: `docs/playstore/data-safety.md`(감사 결과 기반, 별도 초안).

## 8. 그래픽 자산 규격

| 자산 | 규격 | 상태 |
|---|---|---|
| 앱 아이콘 | 512×512 PNG(32비트, 알파 포함 가능), 1MB 이하 | 미제작 — iOS 1024 아이콘에서 유도 |
| 피처 그래픽 | 1024×500 JPEG/24비트 PNG(알파 없음) | 미제작(필수) |
| 휴대전화 스크린샷 | 2~8장, JPEG/24비트 PNG, 각 변 320~3840px, **긴 변 ≤ 짧은 변 × 2** | 미촬영. ⚠ iOS 1320×2868은 비율 2.17이라 그대로 못 쓴다 — 안드로이드 실기기/에뮬레이터에서 1080×1920 등으로 새로 찍거나 세로를 자른다 |
| 7인치·10인치 태블릿 스크린샷 | 각 최대 8장(태블릿 등재 시) | 선택 |

촬영 목록(iOS §10 미러, 안드로이드 화면): ① 검색 결과 ② 장소 상세 ③ 내 주변 지하철 실시간 ④ 길찾기 브리핑 ⑤ AI 채팅 ⑥ 무장애 관광지 ⑦ 설정(언어·받아쓰기·정보 출처). TalkBack 커서를 켠 채 찍으면 접근성 앱임이 드러난다(iOS 촬영 때의 판정과 같이 위원장 검토).

## 9. 위원장 왕복 항목

1. 앱 이름(30자 제약으로 iOS 이름과 다름) 2. 짧은 설명 6로케일 3. 자세한 설명의 안드로이드 차이 문단(TalkBack·점자·받아쓰기 지원 기기) 4. 콘텐츠 등급 AI 질문 답 5. 스크린샷 구성.
