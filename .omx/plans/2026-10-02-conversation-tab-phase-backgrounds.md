# Plan: fundaluri și iconuri dinamice pentru conversațiile Orca

Data: 2026-10-02. Autor: Codex. Stare: plan propus; implementarea acestei funcționalități nu a început.

## Obiectiv și cerințe

Taburile conversațiilor primesc automat un fundal discret pentru faza de lucru și un icon pentru starea curentă a agentului. Titlul conversației rămâne stabil. Culoarea se aplică suprafeței tabului, fără bulina decorativă actuală. Utilizatorul poate fixa manual faza sau culoarea și poate reveni la automat.

Ipoteze de lucru: prima versiune acoperă conversații Codex Native Chat și terminale Codex cu dovezi de sesiune disponibile. Taburile de fișier/browser și agenții fără dovezi compatibile păstrează comportamentul existent. Detectarea este locală și bazată pe evenimente; nu adaugă apeluri LLM sau transmiterea transcripturilor. Acoperirea altor agenți și interfeței mobile reprezintă extensii ulterioare.

### Semantica vizuală propusă

| Fază | Fundal discret | Dovezi necesare |
|---|---|---|
| Necunoscută | Neutru | Nu există dovezi suficiente sau sesiunea s-a schimbat |
| Analiză / explorare | Albastru | Semnal explicit validat sau evenimente reale de explorare |
| Planificare | Violet | Actualizare structurată a planului sau semnal explicit |
| Implementare | Turcoaz | Modificare de fișiere confirmată de un eveniment de editare |
| Testare / verificare | Verde | Pornirea unei verificări recunoscute, cu rezultat urmărit separat |
| Finalizată | Verde discret distinct | Încheiere explicită a obiectivului curent; niciodată simplul sfârșit de răspuns |

Iconul folosește starea existentă: spinner pentru lucru, semn de întrebare pentru intervenție, bifă pentru răspuns încheiat, simbol de eroare pentru eșec confirmat, simbol neutru pentru inactiv/necunoscut. „Blocată” este stare temporară și păstrează faza anterioară. Logo-ul Codex rămâne lângă iconul de stare, conform componentei actuale. Un tooltip spune, de exemplu, „Implementare · Așteaptă răspuns”; culoarea singură nu transmite semnificația.

Un fundal verde de testare înseamnă că se execută verificări, nu că acestea au trecut. Bifa de răspuns încheiat nu certifică finalizarea proiectului.

## Baza verificată în checkout

Checkout de referință: `/home/gion/Projects/orca-native-chat-title-fix-20261002`, branch `fix/native-chat-auto-title-20261002`. Există modificări necomise pentru titluri Native Chat; planul nu le suprascrie. La implementare se verifică din nou diff-ul și baseline-ul, iar lucrul concurent necesită un checkout separat cu provenance documentată.

| Fapt verificat | Referință locală |
|---|---|
| Bulina decorativă este randată separat din `tab.color` | `src/renderer/src/components/tab-bar/SortableTab.tsx:299-304` |
| Tabul citește deja starea agentului prin selector dedicat | `src/renderer/src/components/tab-bar/SortableTab.tsx:101-111` |
| Iconul păstrează identitatea agentului și adaugă starea | `src/renderer/src/components/tab-bar/TerminalTabLeadingIcon.tsx:69-89` |
| Selecția, unread și drag/drop au straturi vizuale existente | `src/renderer/src/components/tab-bar/SortableTab.tsx:185-192,227-230` |
| Setarea manuală a culorii se propagă către runtime-ul remote | `src/renderer/src/store/terminals/terminal-tab-attention.ts:103-128` |
| Tipul unificat conține identitatea entității/hostului, titlurile și culoarea | `src/shared/tab-types.ts:52-77` |
| Sumarul structured oferă sesiune, status, tool și outcome opționale | `src/shared/agent-session-wire.ts:178-216` |
| Titlul Native Chat este derivat prin reguli din primul mesaj relevant | `src/shared/native-chat-conversation-title.ts:49-71` |
| Hook-ul de titlu respectă numele manual și identitatea sesiunii | `src/renderer/src/components/native-chat/useNativeChatConversationTitle.ts:18-24,41-54` |
| Starea agentului aparține hostului de execuție, nu unei copii create în UI | `docs/reference/agent-status-store.md:45-62` |
| Datele restored/stale nu trebuie prezentate ca live | `src/renderer/src/components/tab-bar/terminal-tab-activity-status.ts:67-79` |
| Noile câmpuri wire trebuie să rămână opționale | `docs/reference/remote-wire-compatibility.md:12-29` |
| Culorile și contrastul folosesc tokenuri de temă | `docs/STYLEGUIDE.md:24-28,74-82`; `AGENTS.md:1-5` |

Graful Codebase Memory a fost indexat pentru acest checkout și folosit pentru localizarea componentelor; referințele de mai sus au fost verificate în surse. Absența unui mecanism existent de faze nu este demonstrată exhaustiv: primul lot verifică reutilizarea înainte de a introduce unul nou.

## Decizii de arhitectură propuse

1. Faza de lucru și starea execuției sunt două valori independente. Reutilizăm store-ul și selectorii de stare existenți; UI-ul nu creează un al doilea detector de agent.
2. Metadatele fazei includ identitatea host/workspace/session și generația/turn-ul dacă sunt disponibile, plus fază, sursă și secvența evenimentului. Câmpurile exacte și locul producerului se confirmă în lotul 1. Un eveniment pentru altă sesiune sau o generație anterioară nu poate recolora tabul curent.
3. Ordinea pentru fundal: culoare manuală > fază manuală > fază automată validată > neutru. Setările manuale nu maschează starea reală a agentului. „Revino la automat” elimină override-ul și reproiectează dovezile curente.
4. Titlul se calculează o dată din subiectul conversației; faza se actualizează pe parcurs. Hook-ul de titlu nu este reutilizat ca detector de faze: citește originea conversației, nu activitatea curentă.
5. Detectarea automată consumă evenimentele existente ale sesiunii/jurnalului pe host. Prioritate: semnal explicit structurat din sesiunea curentă > eveniment tool validat > necunoscut. Menționarea unui test în prompt, citarea unui plan și un shell generic nu sunt dovezi de execuție. Nu analizăm terminalul printr-un parser nou bazat pe presupuneri.
6. Reducerul schimbă faza numai pentru evenimente relevante și deduplicate; heartbeat, token streaming și „ok/continuă” nu schimbă faza. O verificare inițiată în timpul implementării poate schimba faza; așteptarea doar schimbă iconul. Eșecul păstrează faza și actualizează iconul prin starea canonică.
7. Persistăm faza cunoscută și override-urile prin proprietarul existent al sesiunii/tabului, nu prin editarea directă a `orca-data.json`. După restart arătăm „Ultima fază cunoscută” și starea live necunoscută până la dovezi proaspete. Reconectarea nu înseamnă succes sau încheiere.
8. Noile date remote sunt aditive, opționale; peer-urile vechi degradează la neutru pentru fază și păstrează starea existentă. Nu introducem un opcode fără negociere. Mobile primește fallback compatibil; UI mobil nu intră în MVP.
9. Fundalul folosește tokenuri semantice și `color-mix`, cu perechi surface/foreground pentru light/dark. Culoarea activă/focus, unread și drag/drop rămân distincte. Eliminăm doar bulina decorativă de culoare din taburile acoperite; indicatorul de stare se păstrează.

## Loturi de implementare, în ordinea dependențelor

Fiecare lot se limitează la aproximativ 2–4 ore, cu un singur writer Codex. Fișierele noi menționate mai jos sunt propuse, nu existente. Loturile care depășesc circa cinci fișiere se împart după contractul stabilit.

### 1. Contractul fazelor și dovada producerului

- Inspectăm evenimente reale, anonimizate/sintetice, pentru Native Chat și PTY Codex; verificăm dacă există deja semnale de fază și cum sunt legate de sesiune.
- Definim reducerul într-un modul propus `src/shared/conversation-work-phase.ts`, plus teste; folosim `src/shared/agent-session-wire.ts` și `src/shared/tab-types.ts` ca puncte de integrare după confirmare.
- Acceptare: analiză, plan, editare, verificare și necunoscut sunt reprezentate; ordine/deduplicare și izolarea sesiunilor au teste; `idle` nu produce `finalizată`.
- Gate: documentăm evenimentele realmente disponibile. Dacă PTY nu oferă semnal suficient, rămâne neutru/manual; MVP automat Native Chat continuă. Semnal explicit nou se proiectează separat, fără modificări globale de hooks în această fază.
- Verificare: teste unitare ale reducerului, inclusiv prompt citat, tool ambiguu și eveniment întârziat.

### 2. Prima integrare automată Native Chat

- Producerul se integrează în calea existentă de status/jurnal, după contractul lotului 1; candidat: `src/main/native-chat/agent-session-wire/structured-agent-session-status-feed.ts`.
- Metadatele ajung în tabul structured prin proiecția existentă, fără cache paralel de stare. Referință de integrare: `src/renderer/src/components/native-chat/StructuredAgentSessionStatusBridge.tsx`.
- Acceptare: o sesiune sintetică trece analiză → planificare → implementare → testare; tabul corect primește faza; „continuă” și finalul unui răspuns nu resetează faza.
- Verificare: teste producer/proiecție plus testul de izolare a două sesiuni.

### 3. Fundal și icon în tabul real

- Extindem `SortableTab.tsx`, `tab-bar-item-surface.tsx` și `TerminalTabLeadingIcon.tsx`; tokenurile intră în `src/renderer/src/assets/main.css`. Introducem un resolver de prezentare mic numai dacă responsabilitatea nu încape în cel existent.
- Acceptare: fundalul ocupă tabul, bulina decorativă dispare pentru taburile acoperite, iconul de stare se schimbă independent; titlul și logo-ul Codex rămân corecte.
- Verificare: teste DOM pentru activ/inactiv, unread, rename și drag; screenshot light/dark prin Playwright CDP pe renderer ascuns. Contrast text cel puțin 4.5:1; controale și indicatori esențiali cel puțin 3:1.

Checkpoint MVP: Native Chat automat funcțional, demonstrat în DOM și prin capturi; fără activarea build-ului în aplicația utilizatorului.

### 4. Control manual și setări

- Extindem meniul `SortableTabContextMenu.tsx` și acțiunile existente din `terminal-tab-attention.ts`; adăugăm „Automat”, alegerea fazei și resetarea override-ului.
- Setările globale au comutatoare distincte pentru fundal automat și icon de stare; nu depind de `tabAutoGenerateTitle`. Locația tipurilor de settings se confirmă înainte de editare.
- Acceptare: manual câștigă peste automat, resetarea restabilește faza curentă, dezactivarea fundalului nu afectează titlul sau iconul; culorile manuale existente sunt păstrate.
- Verificare: teste de precedență și toggles, cu label-uri localizate și navigare prin tastatură.

### 5. Persistență și compatibilitate remote

- Propagăm noile câmpuri opționale prin persist/hydrate și contractele `session.tabs`; punct de referință: `src/renderer/src/runtime/web-session-tabs-sync/terminal-surfaces.ts`. Inventarul complet de serializers/decoders se face înainte de schimbare.
- Acceptare: restart păstrează faza și override-ul; snapshot-ul nu le șterge; schimbarea sesiunii invalidează faza automată veche; restore arată starea neconfirmată.
- Verificare: round-trip persist/hydrate, reconnect, peer vechi/nou în ambele sensuri, câmp necunoscut și snapshot întârziat. Pierderea conexiunii produce stare neverificabilă, nu „finalizat”.

### 6. Terminal Codex și cazurile de layout

- Conectăm PTY doar prin dovezile compatibile validate în lotul 1; reutilizăm `terminal-tab-activity-status.ts` pentru icon/stare.
- Acceptare: Native Chat și terminal view ale aceleiași sesiuni au aceeași fază; taburile distincte nu se influențează. Pentru split cu agenți diferiți, alegem faza pane-ului activ; în lipsa unei identități sigure, neutru. Folder workspaces și taburile mutate între grupuri rămân corecte.
- Verificare: schimbare de view, pane activ, close/reopen, mutare între grupuri, host/workspace identity și sesiune înlocuită. Fără semnal PTY suficient, raportăm explicit acoperire automată UNKNOWN și păstrăm suportul manual.

### 7. Verificare finală și livrare reversibilă

- Rulăm regresiile de titlu deja prezente, testele noii funcționalități, typecheck, quality gate și build; review independent proporțional complexității.
- Scenariu vizual: explorare → plan → editare → teste → așteptare → eroare confirmată → răspuns încheiat → reluare; verificăm tooltip, fundal, icon și faptul că „idle” nu finalizează sarcina.
- Acceptare: criteriile de mai jos sunt PASS sau limitele sunt marcate UNKNOWN, cu dovezi salvate și fără modificări nesolicitate ale aplicației active.
- Pregătim artifact, manifest/hash și rollback care includ patch-ul de titluri existent. Instalarea/restartul se tratează la gate separat, în baza autorității explicite valabile atunci; nu presupunem că autoritatea unui task anterior se extinde la această funcționalitate.

## Criterii finale de acceptare

- [ ] Faza colorează fundalul și starea schimbă iconul independent, în același tab.
- [ ] Un răspuns încheiat sau un test reușit nu marchează singur obiectivul „finalizat”.
- [ ] Tool input ambiguu, text citat și „ok/continuă” nu produc tranziții false.
- [ ] Evenimente duplicate, vechi ori pentru altă sesiune/host sunt ignorate.
- [ ] Override manual > automat; resetarea și toggles au efectul definit.
- [ ] Restart păstrează metadatele, dar nu simulează agent live; reconnect nu declară succes.
- [ ] Titlurile auto/manuale și corecția Native Chat existentă trec regresiile.
- [ ] Light/dark, tab activ/inactiv, unread, pin, drag și tastatură au dovezi DOM/vizuale.
- [ ] Versiunile remote diferite degradează sigur; folder workspaces sunt acoperite.
- [ ] Fără polling nou, scanări repetate ale întregului transcript sau subprocese pentru clasificare; un eveniment al sesiunii A nu rerandează tabul B în testul de izolare.

## Comenzi de verificare

Din checkout-ul efectiv de implementare, cu liste exacte de teste după fiecare lot:

```bash
ORCA_BACKGROUND_LAUNCH=1 pnpm test <fisierele-de-test-ale-lotului>
pnpm tc:web
pnpm tc:node
pnpm run check:code-quality:changed
git diff --check
ORCA_BACKGROUND_LAUNCH=1 ORCA_ELECTRON_VITE_TARGET=renderer pnpm run build:electron-vite --config config/electron-vite-target.config.cts --ignoreConfigWarning
```

Renderer build este suficient doar pentru un lot exclusiv renderer. Dacă producerul main/shared se schimbă, facem build-ul componentelor modificate înainte de lansarea testului. La gate-ul final: `ORCA_BACKGROUND_LAUNCH=1 pnpm test` o singură dată, în limita runtime-ului disponibil; limitările se raportează explicit. Pentru Electron folosim skill-ul `$electron` dacă este disponibil și Playwright CDP, conform `AGENTS.md`; dacă lipsește, validarea vizuală rămâne UNKNOWN până la rezolvarea tooling-ului. Fără focus/show/activarea ferestrei utilizatorului.

## Riscuri și mitigări

| Risc | Măsură |
|---|---|
| Faza dedusă greșit din proză/tool generic | Doar evenimente validate, neutru când sunt ambigue, override manual |
| Semnalele PTY sunt mai slabe decât Native Chat | Gate timpuriu în lotul 1; acoperire și fallback declarate separat |
| Stare veche după restore/reconnect | Păstrăm provenance și regulile de freshness ale store-ului canonic |
| Verde confundat cu PASS | Tooltip explicit și icon de outcome distinct de faza testării |
| Fundalul ascunde selecția/unread | Teste de compoziție și contrast în ambele teme |
| RPC/persistență pierde câmpurile noi | Round-trip și matrice old/new înainte de livrare |
| Regressie peste patch-ul titlurilor necomis | Baseline și diff inventariate; regresii de titlu și artifact cumulativ |
| Cost mare pe streaming | Reducer numai pe evenimente semantice; fără polling și fără fan-out global |

## Handoff

Următorul pas concret este lotul 1: validarea sursei evenimentelor și implementarea contractului/reducerului testat. Planul de față nu autorizează commit, push, instalare, restart, modificări globale de hooks sau deploy. Planificarea a verificat surse și Git; nu a rulat testele aplicației și nu pretinde readiness de implementare sau vizuală.
