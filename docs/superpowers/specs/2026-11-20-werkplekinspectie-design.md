# Werkplekinspectie PWA — ontwerp

Datum: 2026-11-20
Status: concept, wacht op akkoord (bouwer-check verwerkt)

## 1. Waarom

Monteurs van de opdrachtgever (Customer Care, Nederland) vullen op projectlocaties het papieren/Word-formulier
**"Werkplekinspectie Arbo en Milieu"** in. Dat moet makkelijker: een app op de telefoon waarmee ook monteurs die
weinig met apps doen het formulier in een paar minuten invullen, ondertekenen en versturen. Het resultaat komt als
PDF die eruitziet als het originele formulier in de mailbox van de VGM-functionaris. Er wordt niets
blijvend opgeslagen op een server.

Succes = een monteur zonder uitleg de inspectie afrondt, en de VGM-functionaris een herkenbare, complete PDF
ontvangt die hij kan archiveren.

## 2. Doelen, niet-doelen, anti-doelen

**Doelen**
- PWA (installeerbaar op beginscherm), Nederlands, mobiel eerst.
- De 21 controlepunten van het formulier, Ja / Nee / Nvt, met bij Nee: opmerking, "opgelost vóór"-datum, foto's.
- Open vraag "Wat gaat hier goed?", samenvatting met aanpassen, handtekening, versturen.
- Server maakt PDF (liggend A4, zoals origineel) en mailt naar een vast adres uit env. Daarna alles weg.
- Concept blijft op de telefoon tot het verstuurd is (ook bij geen bereik), daarna gewist.
- Docker-image, automatisch gebouwd met GitHub Actions, publiek repo op GitHub (account SilkePilon).

**Niet-doelen**
- Geen login, geen accounts, geen beheeromgeving.
- Geen database, geen archief van inspecties in de app.
- Geen kopie naar de monteur.
- Geen afhandeling van tekortkomingen in de app (kolommen "Actie uitgevoerd door" / "Uitgevoerd (datum)",
  paraaf VGM-functionaris, afmelding blijven leeg op de PDF voor later).
- Geen meertaligheid.

**Anti-doelen** (zou mislukt zijn, ook als het technisch werkt)
- Een monteur raakt werk kwijt (app gesloten, geen bereik).
- De app kan misbruikt worden om mail naar willekeurige adressen te sturen, of om de VGM-functionaris te
  bestoken met spam.
- Inspecties of foto's blijven ergens op een server of in logs staan.
- De UI voelt druk, technisch of "AI-gegenereerd" en schrikt niet-digitale monteurs af.

## 3. Randvoorwaarden

- Hosting: k3s-cluster van de eigenaar, verkeer via **Cloudflare Tunnel**. Alleen een container-image nodig.
  HTTPS wordt door Cloudflare afgehandeld.
- Configuratie alleen via environment variables (ontvanger, afzender, SMTP). Geen instellingenscherm.
- Repo is publiek: geen geheimen in code, image, build-args of CI-logs.
- Gebruik op locatie: handschoenen, fel licht of kelders, slecht bereik, één hand.

## 4. Gekozen aanpak

### Overwogen
| Aanpak | Afweging | Besluit |
|---|---|---|
| **A. Vite + React SPA met kleine Fastify-server in één container** | Klein, weinig aanvalsoppervlak, PDF en validatie op de server, eenvoudig image | **Gekozen** |
| B. Next.js (App Router) | Eén framework, maar herhaalde kritieke CVE's in RSC/Server Actions (2025–2026), zwaarder image, SSR niet nodig | Afgewezen |
| C. PDF op de telefoon maken, server stuurt alleen door | Server kan inhoud niet controleren: iedereen kan elke PDF naar de ontvanger laten mailen | Afgewezen |

### Stack
- **Frontend:** Vite, React, TypeScript, Tailwind CSS v4, shadcn/ui-primitieven (Radix) als basis, eigen
  "speelse" styling (zie §6). `vite-plugin-pwa` (Workbox, `registerType: 'prompt'`).
- **Backend:** Node (LTS), Fastify. Plugins: `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/multipart`
  (of JSON met base64 — keuze bouwer, zie §11), `@fastify/static`. Validatie met zod (strikt).
- **PDF:** pdfkit (server-side), lay-out in code nagebouwd.
- **Mail:** nodemailer (laatste major).
- **Handtekening:** `signature_pad`.
- **Foto's:** `browser-image-compression` op de telefoon.
- **Concept-opslag:** IndexedDB via `idb-keyval`.
- **Container:** multi-stage build, runtime op distroless Node (nonroot) of `node:*-alpine` met `USER node`.

## 5. Gebruikersflow

Eén ding per scherm, in de stijl van Duolingo/Kahoot (zie mockups in `docs/design/mockups/`).

1. **Start** — "Hoi {naam}!". Velden: *Naam* (alleen de eerste keer; daarna onthouden op de telefoon en
   aanpasbaar), *Project*, *Projectnummer*. Datum + tijd worden automatisch gezet. Knop "Start inspectie".
   Als er een onafgemaakt concept is: "Je bent nog bezig met een inspectie" met *Verder gaan* / *Weggooien*.
   Als er afgeronde maar nog niet verstuurde inspecties zijn (zie stap 6, *Later versturen*), staan die bovenaan
   als "Nog te versturen" met per stuk *Nu versturen*. *(Keuze bouwer-check: meerdere onverstuurde inspecties
   tegelijk, zodat een monteur die op twee locaties na elkaar geen bereik heeft niets kwijtraakt. Er is altijd
   maximaal één concept in bewerking.)*
2. **21 vragen**, één per scherm, gegroepeerd per onderdeel (onderdeelnaam + icoon boven de vraag).
   Bovenaan een voortgangsbalk en een sluitknop (X → terug naar start; concept blijft bewaard).
   - Drie grote knoppen: **Ja**, **Nee**, **Niet van toepassing**.
   - **Geen automatisch doorgaan:** een antwoord blijft staan tot de monteur op **Volgende** tikt (ook na
     *Doorgaan* in het Nee-paneel). Onder elke vraag kan een opmerking bij Ja/Nvt.
   - **Nee →** paneel schuift omhoog: "Wat is er mis?" (verplicht), **Opgelost vóór** (datum, verplicht,
     native datumkiezer, niet in het verleden), **Foto** (optioneel, max. 3 per punt). Knop *Doorgaan*.
   - Terug naar de vorige vraag kan altijd (terugknop van telefoon/browser werkt ook).
3. **Wat gaat hier goed?** — open tekstveld, mag overgeslagen worden.
4. **Samenvatting "Klopt alles?"** — tellers (Ja / Nee / Nvt), daarna eerst alle Nee-punten (opmerking, datum,
   aantal foto's, *Aanpassen*), daarna alle onderdelen. Tikken op een punt opent die vraag; na wijzigen
   terug naar de samenvatting (niet verder door de vragen). Knop "Alles klopt, naar tekenen".
5. **Handtekening** — tekenvlak met *Opnieuw*, naam + datum eronder, verklaring
   "Ik heb deze inspectie zelf gedaan en de antwoorden kloppen." (aanvinken verplicht). Knop **Verstuur inspectie**.
6. **Versturen** — knop blokkeert, laadindicator. Resultaat:
   - **Gelukt:** "Verstuurd!" met tellers; concept wordt van de telefoon gewist. Knop *Klaar* → start.
   - **Geen internet / server niet bereikbaar:** "Nog niet verstuurd. Je inspectie staat veilig op deze telefoon."
     *Opnieuw proberen* / *Later versturen*. *Later versturen* zet de ondertekende inspectie in de lijst
     "Nog te versturen" op de telefoon. Geen automatische achtergrond-sync (werkt niet op iOS); wel een
     melding op het startscherm zodra de app weer online is.
   - **Te veel pogingen (429):** uitleg in gewone taal, later opnieuw.
   - **Validatiefout (400):** zou niet moeten voorkomen; toon welk punt aandacht nodig heeft en ga erheen.

### De 21 vragen
Op het scherm staan korte, positieve vragen (taalniveau A2/B1). In de PDF staat de **originele tekst** van het
formulier. Id's volgen het formulier (1A … 9B).

| Id | Origineel (PDF) | Vraag in de app |
|---|---|---|
| 1A | VGM-handboekje voorhanden | Heb je het VGM-handboekje bij je? |
| 1B | bekendheid met calamiteitenplan ter plaatse | Weet je wat je moet doen bij een noodgeval op deze plek? |
| 1C | veiligheidsinstructie opdrachtgever gekregen | Heb je een veiligheidsinstructie van de opdrachtgever gekregen? |
| 1D | LMRA pas voorhanden | Heb je je LMRA-kaart bij je? |
| 2A | goed bereikbaar/opgeruimd/verlicht | Is je werkplek goed bereikbaar, opgeruimd en verlicht? |
| 2B | fysieke belasting/klimaat/geluid/bewegingsvrijheid | Kun je hier goed werken? Denk aan tillen, temperatuur, geluid en ruimte. |
| 2C | veiligheid en afzetting | Is de werkplek veilig en goed afgezet? |
| 3A | staat van onderhoud | Zijn je gereedschap en klimmaterieel in goede staat? |
| 3B | gekeurd | Zijn je gereedschap en klimmaterieel gekeurd? |
| 4A | blusmiddelen aanwezig en bereikbaar | Zijn er blusmiddelen, en kun je erbij? |
| 4B | blusmiddelen gekeurd | Zijn de blusmiddelen gekeurd? |
| 4C | vluchtwegen aanwezig, aangegeven en vrij van obstakels | Zijn de vluchtwegen er, zijn ze aangegeven en zijn ze vrij? |
| 5A | PBM gebruik | Gebruik je de juiste beschermingsmiddelen (PBM)? |
| 6A | worden ze veilig uitgevoerd | Wordt het werk veilig uitgevoerd? |
| 7A | wasgelegenheid aanwezig | Kun je je hier wassen? |
| 7B | kantine of pauzeruimte aanwezig | Is er een kantine of pauzeruimte? |
| 8A | afvalstoffen gescheiden | Wordt het afval gescheiden? |
| 8B | opslagmogelijkheid afvalstoffen aanwezig | Is er een plek om afval op te slaan? |
| 8C | afvoermogelijkheid afvalstoffen aanwezig | Kan het afval worden afgevoerd? |
| 9A | EHBO-doos aanwezig en compleet | Is er een EHBO-doos, en is hij compleet? |
| 9B | persoon met EHBO-diploma aanwezig | Is er iemand met een EHBO-diploma? |

Onderdelen: 1 Instructie, 2 Werkomgeving, 3 Gereedschappen en klimmaterieel, 4 Brandpreventie,
5 Persoonlijke beschermingsmiddelen, 6 Werkzaamheden, 7 Persoonlijke hygiëne, 8 Milieu, 9 EHBO.
De vragenlijst staat op één plek in de code (gedeeld door frontend, validatie en PDF).

## 6. Visuele stijl

Richting gekozen na drie afgewezen rondes (papierformulier-stijl, website-stijl, standaard shadcn = "te druk").
Referentie: **Duolingo / Kahoot** — rustig, speels, één ding per scherm. Mockups:
`docs/design/mockups/flow-vragen.html` en `flow-einde.html` (die tonen nog het paarse logo; zie hieronder).

- **Kleuren (huisstijl opdrachtgever):** aubergine `#26193C` (tekst), violet `#431961` (hoofdknop, voortgang, Ja), donkere
  rand `#26193C` onder knoppen, koraal `#F34842` / donker koraal `#C42B24` alleen voor Nee en fouten,
  lila `#EFE9F7` en roze `#FDECEB` als vlakken voor geselecteerd Ja/Nee, grijs `#E5E5E5` randen.
- **Logo:** het huidige **oranje** logo van de opdrachtgever (`#FF5800`) in app en PDF, maar **niet in het repo**:
  het wordt bij deployment aangeleverd als gemount bestand (zie §11) en door de server geserveerd. Zonder
  logo-bestand toont de app alleen de titel. App-iconen (PWA) zijn een neutraal eigen icoon (bijv. klembord
  met vinkje) in violet, omdat iconen bij het bouwen vastliggen. Kleuren mogen wel in de code.
- **Lettertype:** Nunito (zelf gehost, geen Google Fonts-request in productie), gewichten 600–900.
- **Componenten:** "dikke" knoppen met 5px onderrand (indrukbaar gevoel), radius 16px, antwoordknoppen ≥ 62px
  hoog, hoofdknop ≥ 56px, groot vraaglettertype (~25px), veel witruimte. Nee-paneel als bottom sheet.
- **Toegankelijkheid:** WCAG 2.2 AA minimaal; antwoordknoppen zijn semantisch een radiogroep; status nooit
  alleen via kleur (icoon + tekst); zichtbare focus; `prefers-reduced-motion` respecteren.
- **Taal:** A2/B1, korte zinnen, overal dezelfde woorden (Ja / Nee / Niet van toepassing, Aanpassen, Verstuur
  inspectie → "Verstuurd!").
- Alleen licht thema (leesbaarheid in fel licht).

## 7. PDF (wat de ontvanger krijgt)

pdfkit, **liggend A4**, nagebouwd naar het Word-formulier:
- Kop: logo (uit configuratie, §11), titel "Werkplekinspectie Arbo en Milieu", adresblok (uit configuratie),
  Origineel: Afdeling {afdeling, configuratie, standaard "Customer Care"}, Kopie: VG functionaris (geen Reg-rij),
  Project, Projectnummer.
- Blok handtekeningen: *Inspectie uitgevoerd door* = naam monteur + datum/tijd; *Handtekening monteur* =
  handtekening-afbeelding + datum/tijd; *Handtekening VGM functionaris: {naam uit configuratie}* leeg, zelfde opbouw als de monteur (ruimte + datum + tijd); *Afmelding / gezien d.d.* leeg.
- "Wat gaat hier goed en waar kan de rest van het bedrijf iets van leren?" met de tekst.
- Tabel met kolommen zoals origineel: Omschrijving controlepunt | Ja | Nee | Nvt | Commentaar |
  Vastgesteld door (= naam monteur bij Nee) | Actie vóór (datum) | Actie uitgevoerd door (leeg) |
  Uitgevoerd (datum) (leeg). Rijen groeien mee met tekst; tabel loopt over naar pagina 2 met herhaalde kop.
- "Te nemen actie op punt:" = lijst van Nee-id's.
- Daarna fotobijlage: per foto het punt-id en de vraag als bijschrift.
- Voettekst: "Internal", paginanummer, en "Digitaal ingevuld en ondertekend via de Werkplekinspectie-app op
  {datum tijd}".
- Bestandsnaam: `Werkplekinspectie {jaar}-{project}-{datum}.pdf` (opgeschoond; volgt de naam van het origineel).

## 8. Mail

- Aan: `MAIL_TO` (env). Van: `MAIL_FROM` (env). Nooit gebruikersinvoer in adres- of headervelden.
- Onderwerp: `Werkplekinspectie – {project} ({projectnummer}) – {datum}`; CR/LF verwijderd, lengte beperkt.
- Body (HTML + platte tekst): monteur, project, datum, aantal Ja/Nee/Nvt, en de Nee-punten met opmerking en
  datum, zodat de ontvanger zonder bijlage te openen ziet wat er speelt.
- Bijlage: de PDF. Doel < 10 MB.
- **Provider: Resend via SMTP** (`smtp.resend.com`, poort 465 met `secure: true`, of 587 met `requireTLS`;
  gebruiker `resend`, wachtwoord = Resend API-key). De afzender moet op een in Resend geverifieerd domein staan
  (SPF/DKIM via Resend); geen @het-maildomein-van-de-opdrachtgever als afzender. Resend staat tot ~40 MB per mail toe, maar
  het doel blijft < 10 MB vanwege de ontvangende server.
- Code blijft gewone SMTP (nodemailer), dus elke andere SMTP-provider werkt ook. TLS verplicht, minimaal
  TLS 1.2, certificaat altijd controleren. `transporter.verify()` bij opstarten (loggen, niet crashen).

## 9. Gegevens en privacy

- **Server:** verwerkt alles in geheugen, schrijft niets naar schijf (read-only filesystem), houdt niets vast na
  het versturen (ook niet bij fouten). Logs bevatten geen namen, projecten, opmerkingen of foto's — alleen
  status, duur, grootte en een willekeurig request-id.
- **Telefoon:** concept (antwoorden, foto's, handtekening) in IndexedDB, automatisch opgeslagen na elke tik.
  Gewist direct na een geslaagde verzending, via *Weggooien*, of automatisch na 14 dagen. De naam van de
  monteur blijft apart bewaard voor de volgende keer.
- **Foto's:** op de telefoon verkleind (max. 1600px, JPEG ~0.7) — dit verwijdert ook EXIF/GPS. Max. 3 per
  Nee-punt, max. 15 totaal.
- Service worker cachet nooit `/api/*`.

## 10. Beveiliging

- **Endpoint:** `POST /api/inspecties` (enige schrijvende route) + `GET /healthz`.
- **Rate limiting:** in de app per client-IP, bijv. 5 inzendingen per 15 min per IP plus een globale bovengrens
  (standaard 20 per uur; de app toont bij 429 een duidelijke "probeer het later opnieuw"-melding en de
  inspectie blijft bewaard). Client-IP komt uit `CF-Connecting-IP`; alleen vertrouwd als het verzoek van de tunnel komt
  (configureerbaar via env). Advies in README: daarnaast één Cloudflare rate-limitregel op `/api/`.
- **Honeypot:** verborgen veld; ingevuld → nep-200, niets versturen.
- **Validatie:** zod, strikt: precies de 21 bekende id's, antwoord ∈ {ja, nee, nvt}, bij Nee opmerking +
  datum verplicht, maximaal 250 tekens per tekstveld, handtekening verplicht en niet leeg, foto's alleen
  JPEG/PNG (magic bytes gecontroleerd), aantallen en groottes begrensd. Server rekent niets na op basis van
  vertrouwen in de client.
- **Limieten:** body-limiet op de route (bijv. 12 MB) en per bestand.
- **Herkomst:** alleen same-origin: controle op `Origin` en `Sec-Fetch-Site`, geen CORS-headers.
- **Headers:** helmet met strikte CSP (`default-src 'self'`, geen inline scripts, `img-src 'self' blob: data:`,
  `frame-ancestors 'none'`), `Referrer-Policy: no-referrer`, Permissions-Policy (camera alleen self).
- **Container:** non-root, read-only rootfs, geen extra capabilities, geen geheimen in image of build-args.
- **Supply chain:** lockfile + `npm ci` (of pnpm), Dependabot (npm, docker, actions), actions gepind op SHA,
  minimale `GITHUB_TOKEN`-rechten, `npm audit`/CodeQL in CI, image naar GHCR met provenance + SBOM.

## 11. Configuratie (env)

| Variabele | Voorbeeld | Doel |
|---|---|---|
| `MAIL_TO` | vgm@example.com | Ontvanger (echte adres alleen in de Kubernetes-Secret) |
| `MAIL_FROM` | "Werkplekinspectie <inspectie@jouwdomein.nl>" | Afzender, op een in Resend geverifieerd domein |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | smtp.resend.com, 465, true, resend, re_… | SMTP |
| `ORG_NAME` | Voorbeeld B.V. | Bedrijfsnaam in PDF-kop |
| `ORG_ADDRESS` | meerdere regels, gescheiden door `\n` | Adresblok in PDF-kop |
| `ORG_DEPARTMENT` | Customer Care | "Origineel: Afdeling" |
| `VGM_NAME` | J. Jansen | Naam VGM-functionaris op de PDF |
| `BRAND_LOGO_FILE` | /config/logo.svg | Pad naar gemount logo (SVG of PNG), optioneel |
| `BRAND_ICON_FILE` | /config/icon.svg | Pad naar gemount app-icoon (vierkante SVG), optioneel; vervangt de ingebouwde iconen |
| `BRAND_ICON_BACKGROUND` | #FFFFFF | Kleur rond het icoon voor maskable en Apple, optioneel |
| `PORT` | 8080 | Luisterpoort |
| `PUBLIC_ORIGIN` | https://inspectie.example.com | Publieke URL; inzendingen van een andere herkomst worden geweigerd |
| `TRUST_PROXY` | IP/CIDR van cloudflared | Welke proxy vertrouwd wordt voor client-IP |
| `RATE_LIMIT_PER_IP`, `RATE_LIMIT_WINDOW`, `RATE_LIMIT_GLOBAL_PER_HOUR` | 5, 15m, 60 | Misbruikgrenzen |

Ontbrekende verplichte variabelen → container start niet, met duidelijke melding.

## 12. Oplevering

- Publiek GitHub-repo onder SilkePilon (naam nog te kiezen). Het repo bevat **geen** logo van de opdrachtgever,
  bedrijfsadres, namen of echte mailadressen; die staan alleen in env/Secret/ConfigMap. README in het Nederlands met: wat het is,
  env-variabelen, draaien met Docker, voorbeeld-Kubernetes-manifest (Deployment, Service, Secret-template)
  voor k3s achter Cloudflare Tunnel, Cloudflare rate-limit-advies.
- GitHub Actions: lint, typecheck, tests, build; bij push naar `main` en tags: multi-arch image (amd64 + arm64)
  naar `ghcr.io/silkepilon/<repo>` met tags `latest`, sha en semver.
- Tests: unit (validatie, PDF-opbouw, mail-samenstelling met nep-SMTP), API-tests (rate limit, honeypot,
  limieten, origin-check), en end-to-end voor de hoofdflow.

## 13. Aan de bouwer

- Exacte componentstructuur, state-management, routing (hash of history) en animaties.
- JSON (base64-foto's) vs multipart voor de upload.
- Exacte PDF-maten en typografie binnen "lijkt op het origineel".
- Iconen per onderdeel (lijnstijl, passend bij de mockups).
- App-iconen en splash op basis van het oranje S-signet.

## 14. Aanpassingen na de reviews (bouwfase)

Tijdens het bouwen zijn deze punten bewust anders of scherper ingevuld dan hierboven:

- **Foto's alleen JPEG.** De app maakt van elke foto een JPEG (max. 1600px, ~0,55 MB); de server weigert andere formaten.
  De handtekening is een PNG van 8 bit, niet-interlaced, max. 2400×1600 px. Foto's mogen max. 2000 px per zijde zijn.
- **Bescherming tegen "zip-bommen".** De server controleert PNG's met dezelfde parser als de PDF-bibliotheek en pakt
  de pixeldata met een harde bovengrens uit, zodat een klein bestand de server niet kan laten vastlopen.
- **Max. 2 inzendingen tegelijk** in verwerking; daarboven 429 ("Probeer het later opnieuw"). Pod-geheugen 768Mi.
- **Twee extra uitkomsten in de app:** *te groot* (inspectie past niet; foto's verwijderen via Aanpassen) en
  *traag* (versturen duurde te lang; de wachttijd groeit mee met de grootte, max. 3 minuten).
- **PDF-lettertype Noto Sans** (OFL-licentie) zodat namen met accenten en andere schriften goed op de PDF staan.
- **CSP** staat inline-stijlen toe (`style-src 'self' 'unsafe-inline'`), nodig voor de bottom sheet; scripts blijven
  alleen `'self'`.
- **Kubernetes `Recreate`-strategie** zodat er nooit twee pods tegelijk draaien (de lijst met verzonden inspecties
  staat in het geheugen van één pod, 24 uur).
- **CI:** het image wordt pas gepubliceerd als tests en CodeQL slagen.
- **Nog niet geautomatiseerd:** een end-to-end test in een echte browser. Test vóór ingebruikname handmatig op een
  echte iPhone en Android-telefoon (invullen, foto, handtekening, offline + later versturen).
