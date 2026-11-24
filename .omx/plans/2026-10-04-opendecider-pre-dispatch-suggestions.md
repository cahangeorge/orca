# Orca: sugestie locală înainte de primul mesaj Codex

2026-10-04 · Plan de implementare, fără modificări de cod în această etapă.
Checkout: `/home/gion/Projects/orca-opendecider-shadow-20261003`, branch `codex/opendecider-shadow-pilot-20261003`.
Baseline: `2383e6225d139488dfbd903666c8093ebb95d02b`. Codex este singurul runtime de lucru.

## Obiectiv și limită

Testăm dacă o sugestie locală ajută utilizatorul să aleagă modelul și efortul înainte de primul apel de inferență Codex. Primul pilot folosește numai task-uri publice, text, într-un workspace local deja existent. Alegerea rămâne la utilizator; nicio probabilitate nu declanșează automat execuția.

Livrabilul implementării: un flux separat **„Task nou cu sugestie”**, disponibil numai în checkout-ul pilot cu opțiunea explicit activată. Nu interceptează conversațiile existente. Shadow rămâne observator separat, dezactivat implicit. Nu instalăm pilotul în Orca folosit zilnic.

## Ce indică sursele actuale

| Fapt verificat | Sursă în checkout, linie |
| --- | --- |
| Planul de lansare existent poate fi construit separat de apelul care pornește conversația. | `src/renderer/src/lib/agent-session-launch-plan.ts:55`, `:77`, `:127` |
| Crearea tabului provizoriu pornește mai întâi lansarea; callback-ul `beforeOpen` este prea târziu pentru preflight. | `src/renderer/src/lib/structured-agent-session-provisional-tab.ts:65` |
| Lansarea pornește imediat reconcilierea/crearea și poate stoca promptul în outbox. | `src/renderer/src/lib/structured-agent-session-launch.ts:234`, `:252` |
| Modelul de început intră în `thread/start`; schimbarea la primul turn poate reinjecta instrucțiuni. Nu echivalăm `thread/start` cu inferența. | `src/main/codex/codex-structured-thread-open.ts:93`, `:101` |
| Efortul și modelul au override per turn; permisiunile sunt deținute separat. | `src/main/codex/codex-structured-turn-start.ts:26` |
| Catalogul citește store-ul și poate programa un refresh printr-un app-server scurt, read-only. Nu creează thread și nu solicită inferență; răspunsul poate avea origine `unknown`. | `src/main/runtime/rpc/methods/structured-agent-session-options-read.ts:26`; `src/main/native-chat/agent-model-catalog/agent-model-catalog-service.ts:113`; `src/main/codex/codex-model-catalog-probe.ts:36` |
| `CreateIntentParams` este strict și nu acceptă selecția inițială. Helper-ul host acceptă deja `options` pentru orchestration, dar RPC-ul chat nu le transmite. | `src/shared/rpc-contract/structured-agent-session-params.ts:121`; `src/main/runtime/rpc/methods/structured-agent-session-create.ts:79`; `src/main/runtime/rpc/methods/structured-agent-session.ts:166` |
| `seedOptions` din intent este în renderer, separat de `intent.params` trimis prin RPC. Nu rezolvă singur selecția înainte de creare. | `src/renderer/src/lib/launch-structured-agent-session.ts:138`, `:149`, `:297` |
| Opțiunile ținute în timpul lansării se aplică după create. Refuzul unei opțiuni nu împiedică publicarea. Acest mecanism nu garantează modelul inițial cerut. | `src/renderer/src/components/native-chat/use-structured-agent-session-options.ts:221`; `src/renderer/src/lib/structured-agent-session-launch-options.ts:146` |
| Provider-ul Nano existent are interfață reutilizabilă, endpoint HTTP numai loopback, abort, limite 4096 caractere și cel mult 8 choices pe decizie. | `src/main/decision-shadow/decision-shadow-provider.ts:2`; `src/main/decision-shadow/opendecider-shadow-provider.ts:16`, `:116` |
| Observatorul Shadow cere identitatea unei sesiuni host existente; nu este un serviciu de analiză a draftului. | `src/main/decision-shadow/decision-shadow-runtime.ts:111` |
| Validarea choices/probabilităților și sanitizarea există deja; sanitizarea nu garantează eliminarea tuturor secretelor. | `src/shared/decision-shadow-types.ts:91`; `src/main/decision-shadow/decision-shadow-input.ts:5` |
| Composerul curent trimite prin transport; curăță draftul după acceptare. Nu adăugăm analiza lentă în această cale. | `src/renderer/src/components/native-chat/NativeChatStructuredSession.tsx:197`; `src/renderer/src/components/native-chat/use-native-chat-structured-composer-send.ts:58` |
| Opțiunile de launch au un owner separat. Lansările blank ale aceluiași provider/workspace se grupează, iar persistence/reload nu păstrează selecția explicită nouă. | `src/renderer/src/lib/structured-agent-session-launch-callers.ts:6`; `src/renderer/src/lib/structured-agent-session-launch-registry.ts:71`, `:109`; `src/renderer/src/lib/structured-agent-session-launch-persistence.ts:6`; `src/renderer/src/lib/structured-agent-session-launch-reload.ts:21` |
| Constructorul shared calculează payload fingerprint. Outbox-ul actual elimină whitespace la marginile promptului. | `src/shared/structured-agent-session-create.ts:52`; `src/renderer/src/lib/structured-agent-session-launch.ts:76` |
| Fingerprint-ul attach exclude intenționat toate options. Acesta ajunge în operația durable a rezervării; hash-ul create singur nu impune conflict la schimbarea selecției. | `src/main/native-chat/agent-session-wire/structured-agent-session-attach.ts:95`, `:322`; `src/main/native-chat/agent-session-wire/structured-agent-session-attach-flow.ts:119`; `src/main/runtime/agent-session-record-store.ts:184` |
| Seed-ul existent include Fast; capability-urile sunt în registry-ul protocol. Catalogul are timestamp, nu un câmp version dedicat, și freshness implicit 10 minute. | `src/shared/native-chat-session-option-defaults.ts:35`; `src/shared/protocol-version.ts:331`; `src/main/native-chat/agent-model-catalog/agent-model-catalog-service.ts:41`; `src/main/native-chat/agent-model-catalog/agent-model-catalog-store.ts:14` |

Graph-ul a ajutat descoperirea. Metadatele coverage sunt incomplete; liniile de mai sus au fost citite direct. Referințele sunt ancore pentru plan, nu dovezi de implementare viitoare.

## Flux pentru utilizator

1. Dintr-un pane local Codex, utilizatorul deschide „Task nou cu sugestie”. Se deschide un dialog de draft pentru un **task nou în același workspace**, fără creare de sesiune, tab provizoriu, outbox sau `thread/start`.
2. Scrie cererea. Modelul și efortul curent sunt afișate drept selecție, nu drept rezultat verificat al Codex. Nu există analiză la fiecare tastă.
3. „Analizează local” rulează întâi validări/reguli. Dacă rezultatul nu este suficient și serviciul local este disponibil, solicită Nano o singură dată pentru versiunea acelui draft.
4. Dialogul arată categoria, sugestia de model/efort, proveniența `rules`/`nano`, explicația scurtă dintr-un șablon local și durata. Scorul Nano este marcat **necalibrat**. Abstention apare ca „Nu am suficiente informații”.
5. „Folosește sugestia” schimbă numai selecția din dialog. Utilizatorul poate alege manual din catalog. Niciunul dintre aceste gesturi nu trimite task-ul.
6. Numai **„Trimite în Codex”**, cu selecția finală vizibilă și validată, creează sesiunea cu acel model și trimite promptul o singură dată. „Anulează” păstrează/închide draftul conform stării locale, fără lansare.

Modelul și efortul explicit alese nu modifică setările globale sau opțiunile altor sesiuni. Dacă sugestia e indisponibilă, utilizatorul poate trimite cu o selecție manuală validă. Nu există fallback automat către un LLM pentru analiza draftului.

## Componente și contract

**Reguli întâi.** Verificăm determinist eligibilitatea local/native/new/text-only, catalogul, limitele, comenzile, lipsa contextului și selecția manuală. Alegerea structurată explicită a utilizatorului are prioritate. Indiciile lexicale simple pot sugera o categorie, dar nu demonstrează dificultatea; `README` nu înseamnă automat „Luna este suficient”. Negare, cereri mixte și contradicții duc la abstention. Baseline-ul Python arhivat din `rules-wording-benchmark/baseline.py` rămâne benchmark, nu politică de producție.

**Nano opțional.** Refolosim `DecisionShadowProvider.evaluate` și provider-ul loopback; nu refolosim observer-ul legat de turn. Input: text sanitizat al draftului, categorii existente și perechi model/efort permise de catalog + politica locală. Output: aceleași `task_category` și `execution_lane`, validate prin `validateDecisionShadowAnswers`; `needs_context` este întotdeauna disponibil. Nu trimitem surse, istoric de conversație, fișiere, imagini sau date de cont. Draftul original rămâne separat de textul sanitizat pentru analiză. Nano nu îl rescrie; la Send înghețăm `submittedText` conform normalizării whitespace deja existente în launch și verificăm exact acel text la transport. Nu promitem identitate byte-for-byte cu marginile whitespace eliminate de calea actuală.

**Draft RPC local propus, nu existent:** `decisionDraft.analyze` și anularea lui. Owner-ul vine din contextul RPC local desktop, nu dintr-un `ownerId` ales de renderer. Cererea identifică workspace-ul, `draftId`, `revision`, textul și versiunea catalogului. Host-ul rezolvă workspace-ul și allowlist-ul; ignoră/refuză choices arbitrare ale clientului. Rezultatul este legat de owner/workspace/draft/revision și versiunea choices. Nu inventăm o sesiune/generation/fence Shadow înainte să existe sesiunea.

**Bugete pilot propuse:** un request activ per draft, maximum 4 requests în serviciul local, deadline 5s pentru ready+evaluate; overflow/timeout returnează indisponibil și nu pornește Codex. Acestea sunt limite operaționale de test, nu praguri de confidence. Abort la editare, închidere, navigare sau deconectare; un răspuns vechi nu poate schimba selecția ori trimite. Cache inițial numai în memorie pentru draft/revision/choicesVersion identice; fără cache semantic sau salvare de text pe disc.

**Catalog și choices.** Citim `agentSession.modelCatalog` pentru workspace; pilotul permite refresh-ul existent prin app-server scurt read-only, fără thread/inferență. Logăm separat probe process și inference count. Originea unknown/cache/static nu este probă de acces efectiv; ascundem sugestiile nevalidate și nu pretindem availability. Pilotul permite numai lane-uri native Luna/Sol/Astra recunoscute de provider, intersectate cu catalogul și eforturile valide. Maximum 7 lane-uri + `needs_context`, cu ordine/versionare stabilă; fără trunchiere ascunsă a unei liste mai mari. Dacă intersecția este goală, analiza abstains. Pickerul manual poate oferi alte modele recunoscute de catalog, fără a le pune în choices Nano.

**Freshness și cont.** Pentru un create nou, host-ul validează o intrare `probe`/`live-session`, cu `fetchedAt` finită, în intervalul freshness existent `AGENT_MODEL_CATALOG_FRESH_MS` (10 minute), sub fingerprint-ul contului care va fi pinned de launch. Nu folosește implicit catalogul unei alte sesiuni sau al ultimului cont listat. `choicesVersion` este un digest derivat din origin/fetchedAt/lista normalizată de modele+eforturi/policy version și identitatea opacă host a contului/workspace-ului; nu inventăm un câmp version furnizat deja de API. Dialogul primește o referință opacă la această dovadă; create-ul nou primește referința separat de perechea model/effort. Host-ul revalidează contul/catalogul imediat înainte de prima rezervare. Drift/expiry/refresh failure refuză lansarea și cere refresh + o nouă apăsare Send, fără autosend. Referința nu expune path-ul contului sau auth. Reconcilierea unei operații deja rezervate folosește identitatea și selecția durable inițiale, nu un catalog/setări schimbate; lipsa tokenului in-memory după restart nu justifică un create nou.

**Selecție înainte de creare.** Extindere îngustă, capability-gated, a `agentSession.create` cu `initialOptions` care acceptă exclusiv model/effort și o referință separată la dovada de catalog/cont. Refolosim helper-ul `prepareStructuredAgentSessionCreateForWorktree(...options)` și fluxul existent create/attach/journal, fără al doilea engine de lansare. Host-ul validează perechea și construiește **`{...resolved.options, model, effort}`** înainte de acquire/`thread/start`; nu înlocuiește seed-ul complet cu perechea. Refuzul nu face fallback la default. Nu se schimbă approvalsReviewer, permission policy, fastMode, tools, hooks sau agenți. Constructorul shared și verificarea create host includ aceeași selecție explicită în fingerprint.

**Conflict durable al selecției.** B/C nu pot considera hash-ul create drept dovadă suficientă. Propunerea îngustă: metadata internă host-only `createInitialSelection: {model, effort}` pe `AgentSessionAttachParams`, prezentă numai pentru noul flux. Construim un singur attach object pregătit, cu metadata, **înainte** de hash-ul helper-ului create; același object ajunge la `admitAttachOrRefuse`. `attachFingerprintFields` include condițional această pereche imutabilă; nu include întregul seed rezolvat din settings. `reserveRequestFor` transmite hash-ul în operația deja persistentă `reserveOwner`. Fără metadata, canonicalizer-ul elimină undefined și hash-ul vechi rămâne identic. Schema strictă AttachParams nu acceptă metadata de la client. Astfel testăm conflictul la changed pair + fresh valid create fingerprint, inclusiv concurrent/restart, chiar la rezervarea durable. Înainte de B/C verificăm printr-un test al acestui boundary că operațiile existente se pot reconcilia și că nu trebuie schema/store migration; dacă dovada cere schimbări largi, B/C rămân HOLD și restrângem planul. Nu pretindem că această modificare există deja.

**Limita reconcilierii.** Validation înainte de prima rezervare este separată de replay committed. După un ACK pierdut, host-ul reconstruiește contul/location/selecția din operația/record-ul committed, înainte de a aplica gates pentru un create nou. Cont schimbat, catalog expirat sau model retras nu devin verdict „nimic creat”. Lipsa unei dovezi coerente păstrează UNKNOWN și blochează send/recreate. Ledger-ul are retenție/pruning (`src/main/runtime/agent-session-reservation-admission.ts:92`); fără row disponibil nu promitem deduplicare nelimitată și nu regenerăm automat operation id. Numai refuzul definitiv cu dovadă că providerul nu a fost creat poate permite retry cu operație nouă, păstrând selecția explicită și identitatea task-ului. Testele acoperă account switch/catalog expiry/model withdrawal după ACK pierdut și replay după pruning.

**Expediere.** Propagăm explicit selecția din dialog prin verdict/options/intent/params, fără persistarea preferințelor globale. Înainte de create verificăm din nou revision/workspace/catalog/consimțământul de send. După create și opțiuni confirmate, folosim outbox/journal-ul existent cu un singur message id. Retry/reload/deconectare reconciliază aceeași operație; UNKNOWN nu devine un nou create/send. Dacă selecția host nu corespunde, nu se trimite promptul. ACK dovedește acceptarea, nu succesul task-ului.

**Identitate și reload.** Numai fluxul nou primește un `launchRequestId` înghețat la Send și o identitate distinctă în registry: provider/workspace/launchRequestId. Nu poate intra într-un blank launch pending/UNKNOWN din același workspace. Persistăm numai această identitate, initialOptions și envelope-ul necesar reconcilierii, nu textul draftului în noile loguri. Restore păstrează exact selecția aprobată; nu o reconstruiește din setările curente. Fără schimbări în gruparea Off/resume. Două task-uri noi au identități distincte; un retry al aceluiași task are aceeași identitate/operație/message id. Recovery păstrează livrarea existentă din outbox/journal, fără a reintroduce promptul ca un nou submit.

## Limite și cazuri speciale

- Fluxul normal Off și sesiuni active/resumate rămân pe calea actuală. „Continua” fără context abstains; nu clasificăm transcriptul complet.
- Remote/SSH/web/mobile nu accesează serviciul Nano de pe laptop. Fluxul nou este explicit indisponibil acolo; remote unknown nu înseamnă provider exited.
- Slash commands, skill commands și attachments nu sunt acceptate de noul dialog text-only. UI explică folosirea composerului normal; nu execută comanda și nu elimină attachments în tăcere.
- Modificarea draftului sau workspace-ului invalidează sugestia. Selecția manuală rămâne numai dacă e validă pentru noul catalog. Double-click pe Send are un singur efect; editorul se blochează pe snapshotul confirmat până la settlement.
- Cancel înainte de Send: zero create/start/send. Cancel după confirmare folosește cancel/outbox-ul existent și împiedică livrarea încă neadmisă; nu pretindem că poate retrage un turn deja acceptat.
- Informațiile sensibile și task-urile de security nu primesc downgrade automat. Orice sugestie rămâne orientativă; gates deterministe și human merge authority rămân.
- UI folosește `docs/STYLEGUIDE.md`, tokens/shadcn și traducerile existente; nu expune detalii de RPC/runtime în dialog.

## Implementare în loturi dependente

Root este singurul writer; review-ul nativ este read-only. Fiecare lot: maximum 5 fișiere, inclusiv testele; dacă apar mai multe, împărțim lotul înainte de editare. Nu activăm UI până când backend-ul și transportul selecției au probe. Fiecare lot are checkpoint și verificare; estimările sunt orientative, nu angajamente.

| Lot | Scope permis și dependență | Criterii de acceptare |
| --- | --- | --- |
| A · 1–2h | **Primul lot următor:** tipuri/validare draft + rules pure și teste, maximum 5 fișiere noi în `src/shared/decision-preflight*`. Nu modifică source Shadow. | C1: eligibilitate/abstention validate; C2: schimbarea revision/catalog invalidează output; C3: niciun import renderer/main/provider sau side effect de lansare. |
| B1 · 1–2h | După A: schema `structured-agent-session-params.ts`, `src/shared/structured-agent-session-create.ts`, `src/shared/structured-agent-session-mutation.ts` + maximum 2 teste. | C4: only model/effort în initialOptions, referință separată de catalog; C5a: constructor/fingerprint shared includ aceeași selecție; C6: payload vechi păstrează comportamentul. |
| B2 · 1–2h | După B1: `src/shared/protocol-version.ts`, `structured-agent-session-create.ts`, `structured-agent-session-attach.ts` + maximum 2 teste; gate durable dovedit înainte de wiring. | C5b: create/admit attach calculează aceeași metadata host-only; C5c: conflict pair schimbată cu digest valid/concurență/restart; C5d: hash vechi neschimbat și fără migration. |
| C1 · 1–2h | După B2: handler `structured-agent-session.ts`, host catalog/selection validation + teste în subloturi de maximum 5 fișiere. | C7: pereche validă combinată cu seed înainte de acquire; C8: invalid/partial/stale/account drift zero acquire/send; C9: saved Fast/permisiuni/setări globale identice. |
| C2 · ≤1h | După C1: regenerare `rpc-params-catalog.generated.ts` și teste contract/capability în maximum 5 fișiere. | C6b: old host nu primește noile fields; C7b: capability/readback corecte; C8b: registry/schema concordante. |
| D · 1–2h | După A: evaluator draft local și RPC/client/schema/register în subloturi de maximum 5 fișiere; reutilizează provider/input validation existente. | C10: owner/workspace validate; C11: deadline/queue/abort și stale result testate; C12: reguli decisive zero Nano calls, Nano failure zero frontier calls. |
| E1a · 1–2h | După C2: `structured-agent-session-launch-callers.ts`, `agent-session-launch-plan.ts`, `launch-structured-agent-session.ts` + maximum 2 teste existente. | C13: selecția explicită ajunge la create payload; C14: nu persistă model/effort global; C15a: UNKNOWN păstrează operația, retry definitiv păstrează selecția. |
| E1b · 1–2h | După E1a: `structured-agent-session-launch.ts`, `structured-agent-session-launch-registry.ts` + maximum 3 teste existente. | C15b: task nou nu se grupează cu blank pending/UNKNOWN; C15c: dublu Send/retry aceeași identitate și un singur prompt; C15d: Off/resume păstrează gruparea existentă. |
| E1c · 1–2h | După E1b: `structured-agent-session-launch-persistence.ts`, `structured-agent-session-launch-reload.ts`, `launch-structured-agent-session.ts`, registry dacă necesar + test, maximum 5 fișiere. | C15e: reload păstrează identitatea/initialOptions; C15f: settings schimbate nu schimbă selecția aprobată; C15g: UNKNOWN reconciliat fără nou create/submit, vechile record-uri compatibile. |
| E2 · 1–2h | După D/E1c: hook/state machine și dialog noi + teste, maximum 5 fișiere. | C16: analyze/use-suggestion zero start/send; C17: edit/cancel/disconnect resping rezultatul vechi; C18: Send validează snapshot și un singur submit. |
| E3 · ≤1h | După E2: entry point local pilot în `NativeChatStructuredSession.tsx` și test, eventual catalog/localizare în sublot separat. | C19: flag Off păstrează calea existentă; C20: dialogul creează task nou numai la Send; C21: remote/resume/attachments/comenzi excluse explicit. |
| F · 2–4h | După toate: teste integrate și canary public în **workspace nou**, probe read-only independente, documentație/status; maximum 5 fișiere pe sublot. | C22: zero create/thread-start/turn-start înainte de Send; C23: după Send exact un create și un turn cu model/effort cerute și submittedText identic; C24: oracle task PASS, control Off intact, toate procesele proprii oprite. |

Numele fișierelor noi și capability-ul se fixează în brief-ul lotului respectiv după verificarea registry-ului curent. Nicio modificare paralelă în același worktree. Dacă propagarea selecției cere un refactor larg, oprim înainte de implementare și restrângem pilotul; nu ocolim prin schimbarea setărilor globale sau `setOption` după start.

## Verificare

La fiecare lot: `pnpm test <fișierele .test.ts/.test.tsx afectate>`, `pnpm run typecheck:node`, `pnpm run typecheck:web` după schimbări shared/UI și `pnpm run check:code-quality:changed`. Pentru RPC: `pnpm run verify:rpc-params-catalog` după regenerarea prin scriptul repository-ului. Sunt comenzi pentru implementarea viitoare, nu checks executate în faza de plan.

Probe adverse obligatorii: catalog indisponibil/stale/model retras/effort invalid; cont/catalog schimbate între Analyze și Send; saved Fast true; same operation + changed pair + valid recomputed digest; retry conflicting concurent și restart durable; 4097 caractere; negări/task mixt; command/image refuzate; Nano offline/timeout/response invalid/burst; owner străin; două workspace-uri; edit în timpul analizei; Apply fără Send; dublu Send; alt blank launch pending/UNKNOWN în același workspace; două dialoguri/task-uri distincte; cancel înainte/după confirmare; pierdere ACK/reload/create UNKNOWN; settings schimbate înainte de reload; whitespace la marginile draftului; old host fără capability; Off/remote/resume. Harness-ul numără catalog-probe processes, create, acquire, thread/start și turn/start separat.

Canary F: HOME/userData/workspace public și auth read-only izolate ca în canary-ul anterior; servicii locale pornite explicit, fără autostart. App ascunsă `ORCA_BACKGROUND_LAUNCH=1`; Playwright CDP citește **rendererul real**, fără mock DOM și fără focus/show. Aceasta este probă Electron, nu certificare Chrome-for-Testing sau test manual cu pointer fizic. Capture: selecție înainte/după, screenshot draft/sugestie, payloads audit fără secrete, identități ACK/completed, oracle extern, usage și cleanup. Nu reutilizăm workspace-uri/harness-uri arhivate ca fișiere editabile.

La phase gate rulăm suite-ul complet o singură dată dacă infrastructura permite; startup/GPU failures sunt FAIL/UNKNOWN separate, nu PASS. Istoricul actual are checks țintite PASS, dar full suite FAIL/incomplet; acest plan nu îl transformă în release readiness.

## Resurse și măsurarea utilității

Refolosim runtime-ul Nano local existent cu GPU laptop, loopback și weights offline. Fără instalări, vLLM, server GPU dedicat sau dependență de producție de laptop. Runtime-ul nu pornește automat la deschiderea Orca. Netcup CPU și OCI ARM rămân alternative netestate pentru acest flux.

Canary-ul anterior a măsurat 1032ms pentru prima inferență și 6.836s startup serviciu, într-un singur caz; p95/warm/RAM/VRAM/throughput sunt UNKNOWN. Deadline 5s presupune serviciu deja pornit; cold-start nu este ascuns în acel buget. Nu promitem 28ms.

Păstrăm separat: sugestia, selecția utilizatorului, requested lane, reported lane, final task outcome, retry, latency, usage. Confidence nu este accuracy. Logurile persistente conțin metadate și IDs, fără textul draftului; corecția utilizatorului nu devine automat gold label pentru „cel mai mic model suficient”. Dataset-ul uman rămâne gol până la evaluare reală.

Economia se poate măsura numai după task-uri comparabile pe aceeași versiune/date/output, cu verificare independentă și selecții de model efectiv diferite. Raportăm input/cache/output/reasoning, durata, succesul final, retry și costul local; allowance Codex rămâne UNKNOWN dacă interfața nu expune o măsură atribuită. Integrarea, numărul de sugestii și un canary reușit nu demonstrează economie. Shadow-ul actual a realizat **zero routing savings**.

Nu implementăm în acest pilot: auto-routing, praguri confidence, tool/agent/permission selection, interceptarea deciziilor interne Codex, NO_LLM pentru task-uri arbitrare, dataset privat exportat, model training, gateway comun distribuit, instalare zilnică sau deployment. Următoarea etapă este strict **lotul A**, cu UI și lansare încă inactive.

## Dovezi ale fazei de plan

Baseline canary: `/home/gion/.local/state/orca-opendecider-shadow-20261003/native-orca-canary/native-canary-report.md` și `results.json`. Un task public reușit, două turn-uri forwardate în întreaga fază, trei observații Nano; human gold 0. Backend-ul efectiv servit nu este atestat doar de modelul cerut.

Dovezile acestui plan/review/preservation: `/home/gion/.local/state/orca-opendecider-shadow-20261003/pre-dispatch-planning/`. Checkpoint anterior arhivat înainte de actualizare. Source-urile pilot, source-urile originale și toate fazele sigilate se verifică prin hashes; niciun test de model sau aplicație nu se rulează în această fază.
