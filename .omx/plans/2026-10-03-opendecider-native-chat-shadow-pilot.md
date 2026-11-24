# Plan: OpenDecider în Orca Native Chat, pilot în shadow mode

Data: 2026-10-03. Mod `$plan`: direct. Livrabilul acestei sesiuni este planul; implementarea și rularea experimentului nu au început.

## 1. Cerințe și rezultat urmărit

Vrem să vedem dacă OpenDecider Nano produce recomandări utile când lucrăm în **Codex Native Chat din Orca**, indiferent de proiect. Pilotul trebuie să arate recomandarea lângă alegerea efectivă și să măsoare costul local al acestei observații. Codex continuă să primească exact mesajele și opțiunile pe care le primește astăzi.

În prima etapă testăm două întrebări: categoria cererii și nivelul de model/reasoning recomandat. Nu automatizăm selecția de agenți, tools, teste, oprirea task-ului, aprobările sau acțiunile asupra repository-urilor. Aceste decizii nu sunt toate interceptabile din Orca și ar extinde mult experimentul.

**Succesul pilotului:** recomandarea apare corect în workflow, serviciul local poate lipsi fără să împiedice Codex, iar un eșantion evaluat independent arată dacă merită un benchmark mai mare. **Economia efectivă de allowance în acest pilot este zero prin routing**, deoarece modelul folosit nu se schimbă. Eventualele economii viitoare rămân ipoteze.

## 2. Baseline verificat și puncte reale de integrare

Checkout inspectat: `/home/gion/Projects/orca-native-chat-title-fix-20261002`, branch `fix/native-chat-auto-title-20261002`, HEAD `2383e6225d139488dfbd903666c8093ebb95d02b`. La audit sunt șase fișiere tracked modificate și șase intrări untracked, inclusiv `.omx/` și patch-ul pentru titluri. Ele rămân păstrate. Checkpoint-ul actual spune că funcția de faze ale taburilor este instalată/activată; validarea întregii suite rămâne FAIL/incomplete. Nu deducem din acest document starea live a unui proces: [active-plan.md](/home/gion/Projects/orca-native-chat-title-fix-20261002/active-plan.md:1).

| Fapt din cod | Implicație pentru pilot | Sursă |
| --- | --- | --- |
| Composer-ul structured are transport separat de PTY și golește draftul după acceptare. | Integrăm numai Native Chat structured. Nu interceptăm taste sau comenzile terminalului. | [use-native-chat-structured-composer-send.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/renderer/src/components/native-chat/use-native-chat-structured-composer-send.ts:26) |
| Send-ul acceptat trezește separat bucla de livrare. | `accepted` în Orca nu înseamnă că modelul Codex a început un turn. | [structured-agent-session-host-mutations.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/native-chat/agent-session-wire/structured-agent-session-host-mutations.ts:105) |
| `clientOperationId` devine `clientMessageId`; replay-ul nu retrimite mesajul providerului. | Corelăm și deduplicăm observațiile după identitatea existentă, nu după text sau timp. | [structured-agent-session-mutation-plans.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/native-chat/agent-session-wire/structured-agent-session-mutation-plans.ts:42) |
| Adapterul Codex ajunge în `dispatchCodexTurn`. | Acesta este punctul principal propus pentru observația despre mesajul predat efectiv providerului. | [codex-structured-session-adapter.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-session-adapter.ts:216) |
| `turn/start` primește input și opțiunile sesiunii; mesaje în timpul unui turn pot fi coalesced. | Observația nu modifică payload-ul și nu confundă fiecare mesaj cu un turn nou. | [codex-structured-turn-start.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-turn-start.ts:18), [apelul turn/start](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-turn-start.ts:98) |
| Modelul și effort-ul sunt validate și scrise în opțiunile sesiunii. | Shadow nu apelează `applyCodexStructuredSessionOption` și nu scrie în aceste opțiuni. | [codex-structured-session-options.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-session-options.ts:272) |
| Sesiunea ține active turn IDs, opțiuni cerute, opțiuni raportate și acces la catalog. | Putem separa requested/reported și filtra recomandările după catalogul efectiv. | [codex-structured-session-state.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-session-state.ts:114) |
| Native Chat are transcript, status, approvals și composer distincte. | Introducem o zonă informativă proprie lângă composer, fără a transforma recomandarea în status sau approval. | [NativeChatStructuredSession.tsx](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/renderer/src/components/native-chat/NativeChatStructuredSession.tsx:244) |
| RPC-ul structured este gated; `RpcContext` derivă identitatea/capabilitățile din transport. | Folosim infrastructura existentă și verificăm autoritatea pe host, fără să acceptăm `local: true` de la client. | [structured-agent-session.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/runtime/rpc/methods/structured-agent-session.ts:1), [gate](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/runtime/rpc/methods/structured-agent-session-gate.ts:21), [RpcContext](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/runtime/rpc/core.ts:65) |
| Journal-ul este timeline persistent, versionat și append-only. | Recomandările experimentale stau separat; nu adăugăm un nou item sau migrare de journal. | [agent-session-journal-types.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/shared/agent-session-journal-types.ts:1) |
| Usage este running total per thread, nu consum pentru fiecare notificare. | Folosim ultima valoare/diferențe valide; nu însumăm notificări repetitive. | [codex-subagent-activity.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-subagent-activity.ts:3), [codex-subagent-roster.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-subagent-roster.ts:197) |

Codebase Memory a fost folosit pentru descoperire. Metadatele sale sunt din 2026-10-02, cu coverage incomplet și documente excluse; afirmațiile de mai sus au fost confruntate cu sursele actuale. Nu revendicăm un audit exhaustiv al tuturor transporturilor Orca.

Wiring-ul real identificat: constructorul adapterului este în [structured-agent-session-runtime.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/runtime/structured-agent-session-runtime.ts:218); clientul structured folosește `callRuntimeRpc` și verifică suportul host-ului înainte de methods dependente de capabilități în [structured-agent-session-client.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/renderer/src/runtime/structured-agent-session-client.ts:25). În lotul 0 confirmăm aceste seams în worktree-ul de implementare și includem fișierele de wiring în brief.

Referințe externe verificate: OpenDecider oferă HTTP `/v1/systemone`, `health`, `ready` și `metrics`, cu răspunsuri de tip choice/probabilities/confidence. Adapterul nostru va normaliza acest protocol; nu tratăm `/v1/decide` drept endpoint existent. [Upstream OpenDecider](https://github.com/manjunathshiva/opendecider).

Codex acceptă model/effort la început de turn; `turn/steer` nu acceptă model overrides. Integrarea nu poate intercepta arbitrar raționamentul intern, alegerea tools sau fiecare subagent. [Documentația App Server](https://learn.chatgpt.com/docs/app-server).

## 3. Cum se va prezenta în workflow

1. Deschidem o instanță Orca de dezvoltare izolată, cu profil de date separat. Aplicația instalată și sesiunile existente rămân în funcțiune.
2. Într-un Native Chat Codex local, activăm explicit **Experiment: Shadow** pentru sesiunea respectivă. Activarea este temporară, cu valoare inițială Off; nu schimbă setări globale.
3. Trimitem un task obișnuit. Codex pornește pe modelul ales deja în Orca, fără să aștepte serviciul de decizie.
4. Un card compact, pliabil, arată categoria și recomandarea, apoi modelul cerut și modelul raportat de Codex, dacă este cunoscut. Detaliile tehnice complete rămân în raportul experimentului.
5. Evaluăm rezultatul după task. O recomandare diferită de alegerea curentă nu este automat o recomandare greșită sau corectă.

Exemplu de aspect, **fixture ilustrativ, fără predicție sau latență măsurată**:

```text
Experiment: Shadow
Task: documentație
Recomandat: Luna / high
Cerut în Orca: Sol / medium
Raportat de Codex: Sol / medium
Scor model: 0,83 · necalibrat pentru task-urile noastre
Latență: valoarea măsurată în această observație
```

Stările UI: Off, În evaluare, Recomandare disponibilă, Context insuficient, Serviciu indisponibil, Expirat/anulat. Nu există buton Apply/Auto și nu trimitem recomandarea în promptul Codex. Pentru modelul raportat absent afișăm „necunoscut”, nu valoarea cerută prezentată drept fapt confirmat.

Observăm numai primul task substanțial al sesiunii și cereri autonome ulterioare trimise când nu există turn activ. Comenzi de sesiune, goal commands, mesaje scurte precum „continuă”, atașamente fără text suficient, pointere de orchestration și mesaje în turn activ sunt excluse sau marcate `skipped` cu motiv. Nu pretindem că putem detecta perfect schimbarea de task prin reguli; cazurile ambigue cer context și nu sunt recomandări utilizabile.

## 4. Arhitectura minimă propusă

```text
Native Chat structured → outbox/journal → Codex adapter → turn/start → Codex
                                               │
                                               └→ snapshot mic, asincron
                                                     ↓
                                              DecisionShadowProvider
                                                /             \
                                            Fixture       OpenDecider Nano
                                                               loopback
                                                     ↓
                                           observație pe host → card UI
```

**Nu construim încă un Decision Gateway central pentru toate proiectele.** Păstrăm o interfață mică, independentă de model, în Orca, cu două implementări: fixture pentru verificarea integrării și OpenDecider HTTP pentru inferență reală. Folosim serviciul upstream; nu adăugăm încă un server HTTP de traducere.

### Contract și semantică

Input: textul cererii, un context scurt disponibil fără alt apel LLM, ID-urile de corelare și choices versionate. Fără scanarea repo-ului, transcript integral, imagini, output de tools sau citire de fișiere pentru acest serviciu. Input-ul și redactarea trebuie să încapă în limita checkpoint-ului fixat; depășirea produce `needs_context`/`truncated`, nu certitudine falsă.

Două decizii separate, fiecare cu propriul scor/distribuție:

- `task_category`: `docs`, `implementation`, `debugging`, `research`, `review`, `needs_context`.
- `execution_lane`: perechile model/effort disponibile efectiv în catalog, plus `needs_context`. Lane-urile dorite sunt Luna/high, Sol/medium, Sol/high și Astra/low; un lane absent în catalog nu este oferit modelului. Nu presupunem că profilele CLI locale constituie catalogul contului Orca.

Schema normalizată propusă include `schemaVersion`, `decisionId`, `sessionId`, `clientMessageId`, generația/fence-ul sesiunii, `decisionType`, `choicesVersion`, `choice`, `probabilities?`, `confidence?`, `calibration: uncalibrated`, `provider`, `modelRevision`, `policyVersion`, `inputDigest`, `inputTruncated`, `latencyMs` și `observationState`. Metadata de execuție include separat model/effort cerut, model/effort raportat, `turnId?`, starea livrării și motivul excluderii. Nu deducem un agent/model folosit din recomandare.

Validări: choice trebuie să fie în choices; scorurile finite în intervalul declarat; distribuțiile, dacă există, verificate conform protocolului pin-uit. Răspunsurile malformate, truncarea și lipsa unui lane valid nu produc recomandări utilizabile. Confidence este scorul furnizat de model, nu probabilitate demonstrată că task-ul va reuși. Nu stabilim praguri de automatizare în pilot.

### Livrare și izolare

- Hook-ul principal este un observer injectat în deps-ul adapterului Codex, lângă dispatch. Capturăm metadata la predarea mesajului și programăm munca în afara traseului awaited și a secțiunii serializate de livrare. Observer-ul nu folosește `beforeDispatch` pentru a aștepta HTTP/inferența.
- Corelare după `sessionId + generation/fence + clientMessageId + decisionType + policyVersion`; retries/replay nu dublează inferența în aceeași instanță. ACK-ul providerului și echo-ul ulterior sunt actualizări distincte. Timeout-ul transportului Codex nu este tratat drept dovadă că mesajul nu a fost livrat: [dispatchCodexTurn](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-turn-start.ts:125).
- La Stop, închidere, schimbare de generație sau Off anulăm observațiile pending. Rezultatele tardive nu sunt atașate altui mesaj sau altei sesiuni și nu reactivează pilotul. O observație terminată poate rămâne istorică, cu momentul și starea ei, fără a se prezenta drept status live.
- Provider-ul are AbortSignal, deadline și coadă limitată. Propunere inițială de operare: maximum un request de inferență simultan, patru pending și deadline 5 s; acestea sunt limite de resurse configurabile pentru experiment, **nu praguri de confidence** și nu promisiuni de performanță. După baseline măsurat putem ajusta și versiona configurația.
- State-ul observațiilor este pe host, separat de status/journal. Citirea nu pornește inferență sau Codex. Reutilizăm RPC-ul existent prin metode experimentale separate pentru enable/read/disable, fără opcode nou; polling de cel mult 1 Hz cât există pending, fără polling dacă Off.
- Pilotul acceptă numai clientul desktop local și sesiuni Codex executate local. Verificarea folosește contextul autentificat și ownership-ul sesiunii; caller-ul remote, mobile, SSH/WSL și PTY sunt refuzați/bypassed. Nu exportăm methods către allowlist-ul mobile. Un client/host fără suport se degradează la Off: [remote-wire-compatibility.md](/home/gion/Projects/orca-native-chat-title-fix-20261002/docs/reference/remote-wire-compatibility.md:12).

## 5. Model local, GPU și date

Nano rulează într-un mediu Python izolat, separat de Electron/Node. Fixăm împreună commit/versiune package, checkpoint/revision, dependențe și contractul API înainte de inferență. Pentru început folosim runtime-ul upstream PyTorch/Transformers, fără conversie GGUF, vLLM, GPU server sau alte modele.

GPU RTX 3050 este opțiunea preferată pentru test, dar verificarea anterioară a găsit placa în PCI și `nvidia-smi` nefuncțional. GPU-ul utilizabil rămâne **UNKNOWN** până la o probă CUDA reală în mediul experimentului. Disponibilitatea plăcii nu certifică memoria sau latența. Nu reparăm drivere și nu schimbăm power profile ca parte a pilotului. CPU permite continuarea demonstrației dacă CUDA nu funcționează; rezultatele se raportează separat.

Serviciul ascultă explicit numai pe loopback, pe un port liber ales după inventar; se verifică adresa bind, readiness, model/device/revision. Orca nu descarcă modele și nu pornește serviciul automat. Nu alegem un port fix înainte de verificarea conflictelor și nu preluăm default-ul upstream care poate asculta pe toate interfețele.

Prima probă reală: un fixture public/sintetic fără date private, verificarea JSON-ului efectiv și inferență pe CPU/GPU, apoi același set de cereri scurte în română, engleză și mix. Măsurăm cold start separat de warm inference, RAM/RSS, VRAM dacă disponibilă, CPU, p50/p95 și latența cardului. Nu transferăm cifrele upstream pe acest laptop.

Date de experiment:

- Textul minim redactat este transmis doar către serviciul local aprobat. Prompt brut și transcript nu intră în logul auxiliar; nici în logul serviciului. Nu exportăm surse/date private la un provider extern.
- Inițial păstrăm numai metadata și etichete în memorie. Activarea unui export local pentru evaluare este distinctă; exportul conține metadata, un ID/digest și outcome, nu cererea originală. Un digest nu este anonimizare garantată și se tratează ca date locale private.
- Exemplele cu text necesar benchmark-ului sunt scrise separat, curate/sintetice ori redactate și verificate de om. Provider-ul real trebuie să respecte aceeași validare a contractului ca fixture-ul.
- Pentru exportul activat: fișier local cu permisiuni restrictive, maximum 200 observații/7 zile; fără upload, telemetrie externă ori retenție indefinită. Ștergerea artefactelor experimentului se face numai asupra propriilor artefacte identificate.

## 6. Loturi de implementare propuse

Fiecare lot este o fază bounded de aproximativ 2–4 ore, cu un singur writer Codex per worktree și verificare independentă proporțională. Acestea sunt unități de lucru, nu promisiunea unui număr fix de ore. Nu pornim un goal global sau o instalare în această sesiune.

| Lot | Ce se face | Fișiere/suprafețe propuse | Gate de ieșire |
| --- | --- | --- | --- |
| 0 — Contract și baseline | Alegem worktree separat, profil Orca separat și input/output manifest; verificăm din nou Git/status, versiuni și testele de bază. Inventariem patch-ul de titluri, fără reset/stash global. | HEAD de mai sus, [AGENTS.md](/home/gion/Projects/orca-native-chat-title-fix-20261002/AGENTS.md:1), [active-plan.md](/home/gion/Projects/orca-native-chat-title-fix-20261002/active-plan.md:1). Document nou propus: `docs/plans/opendecider-shadow-pilot-contract.md`. | Baseline executabil și scope înghețat; erorile existente separate de regresii. |
| 1 — Contract, fixture și observer | Construim DTO/validare, provider fixture, store bounded, anulare/deduplicare și politici de eligibilitate. Zero model download și zero apel extern. | Fișiere noi propuse: `src/shared/decision-shadow-types.ts`, `src/main/decision-shadow/decision-shadow-provider.ts`, `decision-shadow-observer.ts` și teste aferente. | Contract tests și lifecycle tests PASS; mock/hanging provider nu blochează send-ul. |
| 2 — Integrare host local | Injecție observer în adapter și wiring la constructorul real; enable/read/disable temporar prin RPC și owner checks. Nu schimbăm semantica send/outbox. | [codex-structured-session-adapter.ts](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-session-adapter.ts:216), [deps](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-session-state.ts:75), [constructor runtime](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/runtime/structured-agent-session-runtime.ts:218), [RPC manifest structured](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/runtime/rpc/methods/structured-agent-session.ts:305). Nou: `src/main/runtime/rpc/methods/structured-agent-session-decision-shadow.ts`. | Request-urile Codex și traseul lifecycle identice cu Off; local/remote separation și replay PASS. |
| 3 — UI demonstrabil | Card informativ și control Off/Shadow per sesiune, polling cu cleanup, fixtures succes/failure/context/stale. Reutilizăm stiluri/primitives; fără badge de „task completed” sau schimbare de tab phase. | [NativeChatStructuredSession.tsx](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/renderer/src/components/native-chat/NativeChatStructuredSession.tsx:294), [client RPC existent](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/renderer/src/runtime/structured-agent-session-client.ts:80). Noi: `NativeChatDecisionShadowCard.tsx`, hook/client dedicat și teste; nou spec E2E. [STYLEGUIDE](/home/gion/Projects/orca-native-chat-title-fix-20261002/docs/STYLEGUIDE.md:9). | Probe DOM în traseul complet host→RPC→pane; capturi hidden light/dark; actual/predicted clar separate. |
| 4 — Nano real | Mediu Python izolat; pin; CPU/CUDA readiness; server numai loopback. Înregistrăm request/response sintetic și implementăm adapterul HTTP cu timeout/validare. Comparăm cu fixture-ul. | Artefacte runtime în director experimental separat; nou `src/main/decision-shadow/opendecider-shadow-provider.ts` și teste. Contract conform [upstream](https://github.com/manjunathshiva/opendecider). | Inferență reală și revision/device dovedite, scoruri validate, test de outage fără afectarea Codex. GPU PASS ori UNKNOWN explicit, CPU separat. |
| 5 — Workflow și verdict | 30 cereri reprezentative, evaluare umană, raport de utilitate/latency/resources; comparăm Off cu Shadow pentru overhead. | Dataset și raport noi în directorul experimentului; fără modificări în aplicațiile proiectelor. | Raport final cu PASS/FAIL/UNKNOWN, rezultate fixture vs real separate și decizie GO/REVISE/STOP pentru un benchmark mai mare. |

În lotul 0 se reconfirmă constructorul adapterului și clientul RPC identificate mai sus, ownership-ul store-ului auxiliar și cleanup-ul în versiunea de bază; scope-ul se îngheață în brief înainte de lotul 2. Denumirile marcate **noi/propuneri** nu sunt fișiere existente și pot fi ajustate după convențiile checkout-ului. Dacă un lot cere scope mult mai mare decât cel enumerat, se împarte înainte de implementare.

Worktree-ul nou pornește de la baseline-ul committed verificat. Patch-ul dirty de titluri nu este mutat automat; compatibility cu el se verifică separat prin copie/patch allowlisted numai după inventar. Build-urile și profilul de test nu înlocuiesc `out/`, user data sau instalarea folosite de aplicația live. Instalarea/activarea în Orca principal nu este gate-ul acestui pilot.

## 7. Criterii de acceptare testabile

| ID | Criteriu | Proba cerută |
| --- | --- | --- |
| A1 | Off nu face request de decizie și nu adaugă polling/observații. | Spy HTTP/observer, UI și wiring test pe sesiune neactivată. |
| A2 | Shadow păstrează input, model, effort, permissions, service tier și numărul de dispatch-uri Codex. | Comparare structurală a apelurilor App Server Off/Shadow cu aceleași fixture-uri; fără apel de setOption sau prompt injection. |
| A3 | Provider blocat lent/timeout/503/malformed nu ține send-ul, Stop sau close în așteptare și nu schimbă outcome-ul Codex. | Deferred promise controlată; dispatch și Stop se termină înainte de rezolvarea providerului; toate erorile sunt capturate. |
| A4 | Retry/replay nu dublează aceeași observație; ACK/echo/outcome sunt corelate corect. | Test clientMessageId repetat, late echo, transport timeout și rezultat respins ulterior. |
| A5 | Rezultate tardive după Off/close/generație nouă nu apar pe alt mesaj și nu marchează task-ul drept terminat. | Race tests și integrare cu pane real; verificare status/tab phase înainte și după. |
| A6 | Mesajele în turn activ, comenzile/goal și followups fără context nu sunt „fresh-turn routing opportunities”. | Fixture-uri specifice și verificare reason/count; fallback `needs_context` pentru caz ambiguu. |
| A7 | Un lane indisponibil, choice invalid, scor nevalid sau input trunchiat nu produce recomandare utilizabilă. | Catalog parțial + contract validation tests; UI arată cauza neutră. |
| A8 | Modelul cerut, recomandat și raportat nu sunt confundate; fără reported afișăm necunoscut. | DOM assertions pe cele trei valori și cazul absent; confidence marcat necalibrat. |
| A9 | Remote/mobile/PTY și sesiuni neactivabile nu pornesc inferență și nu pot activa/citi observațiile altuia. | Test RPC cu contexte autentificate diferite; bypass în UI și host, fără payload-authority flags. |
| A10 | Serviciul real este loopback-only și produce răspunsuri pe checkpoint/revision/device consemnate. | Bind/probes + un request sintetic real; CUDA smoke separat; un fixture nu certifică acest criteriu. |
| A11 | Log/export nu conține prompt, transcript, token, paths sensibile sau body de erori brute. | Capturare payload/log/export cu fixtures de date sensibile; inspecție allowlist și limite de retenție. |
| A12 | UI nu fură focus și rămâne utilizabil în light/dark, pending/error/abstain. | Hidden Electron/Playwright, assertions DOM și capturi; cleanup polling verificat. |
| A13 | Raportul include 30 cereri evaluate, p50/p95 warm/cold distincte, resurse, cazurile excluse și concluzie explicită despre utilitate/overhead. | Dataset manifest și report generate; cererile cu Nano real dovedite prin host→RPC→card sunt identificate separat de fixture/replay. Lipsurile marcate UNKNOWN, fără promisiuni de savings. |

## 8. Eșantion și măsurători

30 cereri pentru pilot: câte 6 documentație/config simplu, implementare bounded, debugging, research și review/security. Limba: 10 română, 10 engleză, 10 mix. Sunt cazuri exploratorii; includem cereri scurte autonome și cazuri cu negații, mai multe condiții și context insuficient. Fixtures de lifecycle/UI sunt suplimentare și nu intră în scorul modelului. Folosim task-uri din mai multe proiecte ca varietate, fără schimbări automate în acele proiecte.

Pentru fiecare cerere fixăm choices și categoria/contextul înainte de a vedea predicția. Eticheta umană pentru lane poate fi un **set de alegeri acceptabile**, cu motiv și mark ambiguu. Alegerea folosită azi în Orca nu este gold label. Cazurile controversate cer încă o evaluare independentă, în afara scorului Nano. Rezultatul task-ului este o observație separată; nu demonstrează ce ar fi făcut un model care nu a fost executat.

Măsurăm: valid-response rate, category accuracy/confusion matrix și F1 exploratoriu, wrong-lane rate pe cazurile adjudecate, abstention/needs-context și coverage, scoruri vs erori, p50/p95 inferență și afișare, cold start, RSS/RAM, VRAM/CPU când pot fi observate. ECE/Brier numai dacă există suficiente etichete independente; cu 30 cazuri evităm concluzii ferme despre calibrare. Înregistrăm configurația, lungimea inputului și RO/EN/mix.

Pentru overhead comparăm Off și Shadow într-un harness controlat, cu dispatch-uri identice și provider de test lent, apoi măsurăm varianta reală. Nu dublăm execuția unui task de utilizator și nu lansăm task-uri Codex puternice doar pentru a genera baseline. Usage total poate fi raportat descriptiv dacă este disponibil, fără a-l transforma în bani sau allowance garantat. Numărul de recomandări pentru un lane mai ieftin este **oportunitate ipotetică**, nu tokeni economisiți.

## 9. Verificare și comenzi pentru implementarea viitoare

Comenzile următoare sunt propuse, **nu executate în sesiunea de planificare**. Rulează în worktree-ul experimental. Scripturile sunt cele ale repo-ului: [package.json](/home/gion/Projects/orca-native-chat-title-fix-20261002/package.json:23), [comenzi AGENTS](/home/gion/Projects/orca-native-chat-title-fix-20261002/AGENTS.md:46).

```bash
git status --short --branch
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/codex/codex-structured-session-adapter.test.ts src/main/codex/codex-structured-session-options.test.ts src/main/native-chat/agent-session-wire/structured-agent-session-status-ownership.test.ts
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/decision-shadow
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/renderer/src/components/native-chat/NativeChatDecisionShadowCard.test.tsx src/renderer/src/components/native-chat/NativeChatStructuredSession.decision-shadow.test.tsx
pnpm tc
pnpm run check:code-quality:changed
git diff --check
ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e tests/e2e/native-chat-decision-shadow.spec.ts --workers=1
```

Fișierele de test noi vor fi create în lotul corespunzător; un path propus nu este un test trecut. La gate-ul final rulăm o dată suita completă, raportând separat baseline failures și regresiile. Testele cu App Server fals nu sunt probe de inferență reală.

E2E cere build în mode e2e, cu helper-ele existente și `ORCA_BACKGROUND_LAUNCH=1`; nu folosim `SKIP_BUILD=1` peste un build obișnuit. Validarea rendered încarcă skill-ul Electron aplicabil și folosește renderer ascuns/Playwright CDP disponibil, fără reveal/focus în desktopul utilizatorului: [tests/AGENTS.md](/home/gion/Projects/orca-native-chat-title-fix-20261002/tests/AGENTS.md:5), [tests/e2e/AGENTS.md](/home/gion/Projects/orca-native-chat-title-fix-20261002/tests/e2e/AGENTS.md:3). Dacă accesul vizual lipsește, criteriul rămâne UNKNOWN; testele unitare nu îl înlocuiesc.

## 10. Riscuri, rollback și decizia următoare

| Risc | Măsură concretă |
| --- | --- |
| Nano recomandă prea ieftin fără context de repo. | Input bounded și abstention, evaluare de lane cu acceptabilitate independentă; zero autoritate asupra execuției. |
| Scor mare este interpretat ca task success probability. | Label necalibrat și distribuție per întrebare; nicio automatizare bazată pe score în pilot. |
| GPU nu funcționează sau ține laptopul activ/scade responsivitatea. | CUDA smoke separat; CPU control; măsurare RSS/VRAM/CPU și observații energie/temperatură disponibile, fără tuning automat. |
| Inferență sau HTTP blochează main/host queue. | Serviciu separat, munca programată în afara dispatch awaited, limite, timeout, AbortSignal și teste cu provider nerezolvat. |
| Restart/replay/coalescing falsifică numărul de oportunități. | Identități existente + generation/fence, delivery/turn distincte, skipped reasons și late-result tests. |
| Recomandarea devine din greșeală status sau prompt. | Store auxiliar separat, fără item journal/setOption/prompt injection; teste pe payload și status/tab phase. |
| Conflict cu title patch sau profilul Orca live. | Worktree/profil/build izolate, manifest dirty înainte/după, compatibility test separat, fără instalare în app principal. |
| Date private ajung în log sau endpoint remote. | Endpoint loopback, host-only config, input minim/redactat, export metadata allowlisted și teste negative. |
| Se declară savings dintr-un experiment observational. | Raport separat actual usage vs ipoteze; zero routing savings acum, outcome contrafactual necunoscut. |

Rollback-ul pilotului este Off: anulează pending, închide polling și lasă send/Codex intact. Oprirea instanței/serviciului experimental folosește numai identitățile experimentului, fără restart sau oprire a aplicației principale. Artefactele locale și patch-ul rămân reviewable; nu executăm reset/clean sau ștergeri generale.

Verdictul lotului 5 este **GO** numai pentru dataset/benchmark mai mare dacă A1–A13 trec, există recomandări adjudecate ca utile în observațiile cu Nano real prin host→RPC→card și un reviewer consemnează de ce overhead-ul măsurat este acceptabil pentru continuarea investigației. Raportul indică exemplele, erorile, p50/p95 și efectul asupra experienței, nu doar faptul că serviciul răspunde. **UNKNOWN nu poate deveni GO. REVISE** se aplică dacă integrarea merge, dar contextul/scorurile/latency ori probele sunt insuficiente; **STOP** dacă utilitatea observată nu justifică overhead-ul. Nu cerem un prag de accuracy de producție pentru 30 de cazuri și nu autorizăm Auto, producție sau schimbarea modelelor sesiunilor.

Dacă pilotul merită continuat, următorul pas este dataset de 200–500 cazuri și compararea Nano cu reguli/classifier/embeddings și o referință OpenAI pe payload aprobat. Routing-ul real înainte de Codex se planifică separat: inclusiv înainte de crearea thread-ului când se poate, deoarece schimbarea ulterioară poate reinjecta promptul modelului, comportament deja acoperit de [testul adapterului](/home/gion/Projects/orca-native-chat-title-fix-20261002/src/main/codex/codex-structured-session-adapter.test.ts:66). Cazurile resume/active turn cer politici diferite. Nu implementăm acum MCP global, selecție automată de subagents/tools, server permanent Netcup/OCI, alte decision models sau fine-tuning.

## 11. Starea acestui livrabil

- PASS: surse/Git/status inspectate read-only; plan cu hook-uri reale și criterii verificabile.
- PASS: review arhitectural independent al planului, verdict APPROVED. Această aprobare privește planul, nu implementarea sau runtime-ul.
- NOT RUN: implementare, build/tests ale pilotului, descărcare model, server, CUDA inference și task-uri de evaluare.
- UNKNOWN: latență/resurse Nano pe laptop, utilitate RO/EN/mix, calibrare pentru task-urile noastre și savings viitoare.
- Modificare intenționată în această sesiune: numai acest plan nou. `active-plan.md`, aplicația live, configurarea Codex și sursele existente nu sunt actualizate.

Următorul pas concret este lotul 0 în scope separat, apoi demonstrația host→UI cu fixture, înainte de testul Nano real.
