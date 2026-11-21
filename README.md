# Werkplekinspectie

Een web-app (PWA) voor de **Werkplekinspectie Arbo en Milieu**. Een monteur vult de inspectie op de
telefoon in: 21 vragen met *Ja*, *Nee* of *Niet van toepassing*, bij *Nee* een opmerking, een datum en
eventueel foto's. Daarna zet de monteur een handtekening en verstuurt de inspectie. De server maakt er een
PDF van die op het papieren formulier lijkt en mailt die naar de VGM-functionaris. Zonder bereik blijft de
inspectie veilig op de telefoon staan en kan die later verstuurd worden.

Hoe het eruitziet: open de ontwerpen in [`docs/design/mockups/`](docs/design/mockups/)
([vragen](docs/design/mockups/flow-vragen.html) en [einde van de flow](docs/design/mockups/flow-einde.html))
in je browser.

De app en de server draaien samen in één container. Het image wordt automatisch gebouwd, pas nadat alle
controles in CI geslaagd zijn, en staat op `ghcr.io/silkepilon/werkplekinspectie`.

## Inhoud

- [Functies](#functies)
- [Privacy: wat wordt waar bewaard](#privacy-wat-wordt-waar-bewaard)
- [Configuratie](#configuratie)
- [Lokaal ontwikkelen](#lokaal-ontwikkelen)
- [Draaien met Docker](#draaien-met-docker)
- [Installeren op k3s](#installeren-op-k3s)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Mail via Resend](#mail-via-resend)
- [Bijwerken](#bijwerken)
- [Beveiliging](#beveiliging)
- [Licentie](#licentie)

## Functies

- Installeerbaar op de telefoon (PWA); werkt ook zonder internet tot het moment van versturen.
- Eén vraag per scherm, grote knoppen, eenvoudige Nederlandse teksten.
- Bij *Nee*: opmerking, "Opgelost vóór"-datum en maximaal 3 foto's (in totaal maximaal 15). Foto's worden op
  de telefoon verkleind.
- Samenvatting met *Aanpassen*, een vak voor goede punten, en een handtekening.
- Elke tik wordt automatisch opgeslagen. Lukt versturen niet, dan komt de inspectie in een wachtrij
  (*Later versturen*) en kan die later opnieuw verstuurd worden.
- Twee keer tikken of opnieuw proberen geeft geen tweede mail: de server onthoudt 24 uur welke inspecties al
  verstuurd zijn. Die lijst staat alleen in het geheugen; na een herstart van de container is hij leeg, en
  een poging die daarna nog eens binnenkomt wordt opnieuw gemaild.
- De ontvanger krijgt een mail met een samenvatting en de PDF als bijlage.
- Logo, bedrijfsnaam, adres en namen komen uit de configuratie, niet uit de code.

## Privacy: wat wordt waar bewaard

| Waar | Wat | Hoe lang |
|---|---|---|
| Telefoon (IndexedDB in de browser) | Het concept: antwoorden, opmerkingen, foto's en handtekening | Tot het versturen gelukt is, tot de monteur op *Weggooien* tikt, of 14 dagen na de laatste wijziging |
| Telefoon (IndexedDB) | Ondertekende inspecties die nog niet verstuurd zijn (wachtrij) | Tot ze verstuurd zijn |
| Telefoon (IndexedDB) | De naam van de monteur, voor de volgende keer | Tot de browsergegevens gewist worden |
| Server | De inspectie, alleen in het geheugen, zolang het maken van de PDF en het versturen duurt | Enkele seconden; daarna weg, ook bij een fout |
| Server (geheugen) | Het willekeurige id van verstuurde inspecties, om dubbele mails te voorkomen | 24 uur, of tot de container herstart |
| Server (logs) | Alleen status, duur, grootte en een willekeurig request-id | Volgens je logbeleid |
| Mailbox van de ontvanger | De mail met de PDF | Volgens het beleid van de ontvanger |

- De server schrijft niets naar schijf (de container heeft een read-only filesystem).
- Logs bevatten geen namen, projecten, opmerkingen of foto's.
- Het verkleinen van foto's op de telefoon haalt ook EXIF-gegevens weg, zoals de GPS-locatie.
- De service worker slaat nooit iets van `/api/` op.

## Configuratie

Alle instellingen komen uit omgevingsvariabelen (env). Ontbreekt een verplichte waarde of klopt een waarde
niet, dan start de container niet en staat in de log welke variabelen niet goed zijn. Voorbeeldwaarden staan
in [`.env.example`](.env.example).

| Variabele | Verplicht | Voorbeeld | Waarvoor |
|---|---|---|---|
| `MAIL_TO` | ja | `vgm@example.com` | Ontvanger van de inspecties (precies één adres) |
| `MAIL_FROM` | ja | `Werkplekinspectie <inspectie@example.com>` | Afzender; moet op een in Resend geverifieerd domein staan |
| `SMTP_HOST` | ja | `smtp.resend.com` | SMTP-server |
| `SMTP_PORT` | nee | `465` (standaard) | SMTP-poort |
| `SMTP_SECURE` | nee | `true` | `true` = TLS vanaf het begin (poort 465). Standaard `true` bij poort 465, anders STARTTLS (verplicht) |
| `SMTP_USER` | ja | `resend` | SMTP-gebruiker |
| `SMTP_PASS` | ja | `re_xxx` | SMTP-wachtwoord (bij Resend: de API-key) |
| `ORG_NAME` | nee | `Voorbeeld B.V.` | Bedrijfsnaam in de kop van de PDF |
| `ORG_ADDRESS` | nee | `Voorbeeldstraat 1\n1234 AB Voorbeeldstad` | Adresblok in de PDF; regels scheiden met `\n` |
| `ORG_DEPARTMENT` | nee | `Customer Care` (standaard) | Afdeling op de PDF |
| `VGM_NAME` | nee | `J. Jansen` | Naam van de VGM-functionaris op de PDF |
| `BRAND_LOGO_FILE` | nee | `/config/logo.svg` | Pad naar een gemount logo (SVG of PNG). Leeg = geen logo. Staat het ingesteld maar is het bestand er niet, dan start de container niet |
| `BRAND_ICON_FILE` | nee | `/config/icon.svg` | Pad naar een gemount, vierkant app-icoon (SVG). De server maakt er bij het starten alle icoonbestanden van en gebruikt die in plaats van het neutrale icoon. Leeg = het neutrale icoon. Onleesbaar bestand = de container start niet |
| `BRAND_ICON_BACKGROUND` | nee | `#FFFFFF` | Kleur rond het icoon waar het de hele tegel moet vullen (Android "maskable", iPhone). Kies de achtergrondkleur van het icoon zelf |
| `PORT` | nee | `8080` (standaard) | Poort waarop de server luistert |
| `PUBLIC_ORIGIN` | ja | `https://inspectie.example.com` | Publieke URL, alleen schema en host. Inzendingen van een andere herkomst worden geweigerd. Met `NODE_ENV=production` moet dit `https://` zijn |
| `TRUST_PROXY` | nee | `10.42.0.0/16` | Kommalijst van IP's of CIDR-blokken van de proxy (cloudflared) waarvan de header `CF-Connecting-IP` vertrouwd wordt. Zie [Cloudflare Tunnel](#cloudflare-tunnel) |
| `NODE_ENV` | nee | `production` | Staat in het image al op `production` |
| `RATE_LIMIT_PER_IP` | nee | `5` (standaard) | Maximaal aantal inzendingen per IP-adres per `RATE_LIMIT_WINDOW` |
| `RATE_LIMIT_WINDOW` | nee | `15 minutes` (standaard) | Tijdvak voor de limiet per IP, bijv. `15 minutes`, `15m`, `1h`. **Let op:** een kaal getal is in milliseconden (`900000` = 15 minuten). Minimaal 1 seconde |
| `RATE_LIMIT_GLOBAL_PER_HOUR` | nee | `20` (standaard) | Maximaal aantal inzendingen per uur voor alle gebruikers samen |

Bij te veel inzendingen krijgt de monteur de melding om het later opnieuw te proberen; de inspectie blijft op
de telefoon bewaard.

## Lokaal ontwikkelen

Nodig: Node.js 26 en npm.

```bash
npm ci
cp .env.example .env
```

Pas `.env` aan voor lokaal gebruik:

```bash
NODE_ENV=development
PUBLIC_ORIGIN=http://localhost:5173
BRAND_LOGO_FILE=
BRAND_ICON_FILE=
```

Met de nepwaarden voor SMTP start de server gewoon (de log meldt `smtp_verify_failed`), maar versturen mislukt.
Vul echte SMTP-gegevens in als je het versturen wilt testen.

Start daarna in twee terminals:

```bash
npm run dev          # de app op http://localhost:5173 (Vite)
npm run dev:server   # de API op poort 8080; leest .env
```

Vite stuurt `/api` door naar de server op poort 8080. Andere commando's:

```bash
npm run lint
npm run typecheck
npm run build        # bouwt dist/client en dist/server
npm test             # de tests; voer eerst `npm run build` uit, één test start de gebouwde server
npm start            # start de gebouwde server
```

## Draaien met Docker

```bash
docker run --rm -p 8080:8080 \
  --read-only --tmpfs /tmp \
  -e NODE_ENV=development \
  -e PUBLIC_ORIGIN=http://localhost:8080 \
  -e MAIL_TO=vgm@example.com \
  -e MAIL_FROM='Werkplekinspectie <inspectie@example.com>' \
  -e SMTP_HOST=smtp.resend.com \
  -e SMTP_USER=resend \
  -e SMTP_PASS=re_xxx \
  -e ORG_NAME='Voorbeeld B.V.' \
  -e VGM_NAME='J. Jansen' \
  -e BRAND_LOGO_FILE=/config/logo.svg \
  -v "$PWD/logo.svg:/config/logo.svg:ro" \
  ghcr.io/silkepilon/werkplekinspectie:latest
```

Open daarna <http://localhost:8080>. `NODE_ENV=development` is hier alleen nodig omdat `PUBLIC_ORIGIN` geen
`https://` is; laat het in productie weg. Geen logo? Laat dan `BRAND_LOGO_FILE` en `-v` weg.

Gebruik je `--env-file`: Docker neemt aanhalingstekens letterlijk over. Schrijf dus
`MAIL_FROM=Werkplekinspectie <inspectie@example.com>` zonder aanhalingstekens.

Zelf bouwen kan ook: `docker build -t werkplekinspectie .`

## Installeren op k3s

De voorbeeldbestanden staan in [`deploy/k8s/`](deploy/k8s/). Ze hebben geen vaste namespace; in de
voorbeelden hieronder heet die `werkplekinspectie`.

**1. Namespace**

```bash
kubectl create namespace werkplekinspectie
```

**2. Secret met de mailgegevens.** Vervang de voorbeeldwaarden. Tip: zet een spatie vóór het commando, dan
komt het (in bash met `HISTCONTROL=ignorespace`) niet in je geschiedenis.

```bash
kubectl -n werkplekinspectie create secret generic werkplekinspectie \
  --from-literal=MAIL_TO=vgm@example.com \
  --from-literal=MAIL_FROM='Werkplekinspectie <inspectie@example.com>' \
  --from-literal=SMTP_HOST=smtp.resend.com \
  --from-literal=SMTP_PORT=465 \
  --from-literal=SMTP_SECURE=true \
  --from-literal=SMTP_USER=resend \
  --from-literal=SMTP_PASS=re_xxx
```

Zie ook [`secret.example.yaml`](deploy/k8s/secret.example.yaml). Zet echte waarden nooit in Git.

**3. ConfigMap met de overige instellingen.** Kopieer
[`configmap.example.yaml`](deploy/k8s/configmap.example.yaml), vul je eigen `PUBLIC_ORIGIN`, bedrijfsgegevens
en namen in, en pas het toe:

```bash
cp deploy/k8s/configmap.example.yaml configmap.yaml   # buiten Git houden
# bewerk configmap.yaml
kubectl -n werkplekinspectie apply -f configmap.yaml
```

**4. Logo** (optioneel; SVG of PNG):

```bash
kubectl -n werkplekinspectie create configmap werkplekinspectie-branding --from-file=logo.svg
```

Het logo komt dan op `/config/logo.svg` in de container. Gebruik je een PNG, maak de ConfigMap dan met
`--from-file=logo.png` en zet `BRAND_LOGO_FILE=/config/logo.png`. Geen logo? Haal `BRAND_LOGO_FILE` uit de
ConfigMap.

Een eigen app-icoon (optioneel) gaat op dezelfde manier: voeg `--from-file=icon.svg` toe aan die ConfigMap en
zet `BRAND_ICON_FILE=/config/icon.svg`. Gebruik een vierkante SVG (bijv. `viewBox="0 0 512 512"`) met het
beeldmerk binnen de middelste 80%, zodat Android het in een cirkel kan bijsnijden. Telefoons die de app al
hebben, tonen het nieuwe icoon pas na opnieuw installeren.

**5. Deployment en Service**

```bash
kubectl -n werkplekinspectie apply -f deploy/k8s/deployment.yaml -f deploy/k8s/service.yaml
kubectl -n werkplekinspectie rollout status deployment/werkplekinspectie
kubectl -n werkplekinspectie logs deployment/werkplekinspectie
```

In de log hoort `smtp_ok` te staan. Staat er `smtp_verify_failed`, controleer dan de SMTP-gegevens.

Goed om te weten:

- De Deployment draait **precies één replica**, met de strategie `Recreate`. De rate limits en de lijst met al
  verstuurde inzendingen staan in het geheugen van de pod. Met meer replica's (of twee pods tegelijk tijdens
  een rolling update) heeft elke pod zijn eigen tellers en lijst. Na een herstart beginnen de tellers en de
  lijst opnieuw. Een update geeft daardoor een paar seconden geen service; de app op de telefoon houdt de
  inspectie dan gewoon vast.
- De server verwerkt maximaal 2 inspecties tegelijk (een derde krijgt even "te veel" en kan het zo opnieuw
  proberen). Het geheugen is begrensd op 768Mi.
- De container draait als gewone gebruiker, met een read-only filesystem, zonder extra rechten en zonder
  service-account-token. Alleen `/tmp` is schrijfbaar (een `emptyDir`).
- Is het package op GHCR niet publiek, dan heeft k3s een `imagePullSecret` nodig. Zet het package na de eerste
  build op *Public* (GitHub → je profiel → Packages → werkplekinspectie → Package settings).

## Cloudflare Tunnel

De app is niet direct vanaf internet bereikbaar; Cloudflare Tunnel (`cloudflared`) stuurt het verkeer door.

1. Draai `cloudflared` in het cluster (bijvoorbeeld als Deployment in een eigen namespace).
2. Maak in het Cloudflare-dashboard (Zero Trust → Networks → Tunnels → jouw tunnel → *Public Hostname*) een
   hostname aan, bijv. `inspectie.example.com`, met als service **HTTP** en als URL
   `werkplekinspectie.werkplekinspectie.svc.cluster.local:80` (service `werkplekinspectie`, poort 80, in
   namespace `werkplekinspectie`). Staat `cloudflared` in dezelfde namespace, dan is `werkplekinspectie:80`
   genoeg.
3. Zet `PUBLIC_ORIGIN` op precies die URL: `https://inspectie.example.com`.

### TRUST_PROXY: het echte IP-adres van de gebruiker

Alle verzoeken komen binnen via de `cloudflared`-pod. Zonder instelling ziet de app dus maar één IP-adres, en
delen alle monteurs samen één limiet van 5 inzendingen per 15 minuten. Cloudflare zet het echte IP-adres in
de header `CF-Connecting-IP`. Die header mag de app alleen geloven als het verzoek echt van `cloudflared`
komt; anders kan iedereen een nep-IP meesturen.

Daarom: zet in `TRUST_PROXY` het IP-adres of CIDR-blok waar de `cloudflared`-pod vandaan komt. Bij k3s krijgen
pods standaard een adres uit `10.42.0.0/16`, dus `TRUST_PROXY=10.42.0.0/16`. Heb je een andere pod-CIDR
(`--cluster-cidr`), gebruik dan die. Alleen voor verzoeken van die adressen wordt `CF-Connecting-IP` gebruikt;
voor alle andere telt het IP-adres van de verbinding zelf. (Andere pods in het cluster vallen ook binnen dit
blok; daarom is de Service alleen binnen het cluster bereikbaar.)

### Advies: een rate-limitregel bij Cloudflare

Zet in Cloudflare (Security → WAF → Rate limiting rules) één regel op paden die beginnen met `/api/`,
bijvoorbeeld blokkeren bij meer dan een handvol verzoeken per IP in korte tijd (kies wat je plan toelaat).
Zo wordt misbruik al tegengehouden voordat het bij de app komt.

Waarom dit belangrijk is: de globale limiet (`RATE_LIMIT_GLOBAL_PER_HOUR`, standaard 20 per uur) telt elk
verzoek dat door de limiet per IP komt. Ook verzoeken die daarna geweigerd worden, zoals een ingevuld
honeypot-veld, een te groot of een ongeldig verzoek, tellen mee. Een paar IP-adressen kunnen de globale
limiet dus opmaken, waarna echte monteurs een uur moeten wachten (hun inspectie blijft wel bewaard).

## Mail via Resend

De app verstuurt mail via gewone SMTP; elke SMTP-provider werkt. Met [Resend](https://resend.com):

1. Voeg in Resend je domein toe en verifieer het (zet de DNS-records voor SPF en DKIM die Resend geeft).
2. Maak een API-key met alleen het recht om te versturen (*Sending access*).
3. Instellingen:
   - `SMTP_HOST=smtp.resend.com`
   - `SMTP_PORT=465` en `SMTP_SECURE=true` (of poort `587`; dan is STARTTLS verplicht)
   - `SMTP_USER=resend`
   - `SMTP_PASS=` de API-key (`re_…`)
   - `MAIL_FROM` op het geverifieerde domein, bijv. `Werkplekinspectie <inspectie@jouwdomein.nl>`

TLS is altijd verplicht (minimaal TLS 1.2) en het certificaat van de server wordt altijd gecontroleerd.

## Bijwerken

Bij elke push naar `main` bouwt GitHub Actions een nieuw image (amd64 en arm64) met deze tags:

- `latest`: de laatste versie van `main`;
- `sha-<korte commit>`: precies één commit;
- `1.2.3`, `1.2` en `1`: bij een versietag `v1.2.3`.

De Deployment gebruikt `latest` met `imagePullPolicy: Always`. Een nieuwe versie ophalen:

```bash
kubectl -n werkplekinspectie rollout restart deployment/werkplekinspectie
```

Wil je zelf bepalen wanneer er een nieuwe versie komt, zet dan een vaste tag in de Deployment
(bijv. `ghcr.io/silkepilon/werkplekinspectie:1.2.3`) en wijzig die bij een update.

Op de telefoons verschijnt na een update de melding "Er is een nieuwe versie." met de knop *Vernieuwen*. Die
melding komt alleen op het startscherm, nooit midden in een inspectie. Na *Vernieuwen* laadt de nieuwe versie;
concepten en de wachtrij blijven bewaard.

## Beveiliging

- Eén schrijvende route (`POST /api/inspecties`), met strikte validatie, groottelimieten, een controle op
  het echte bestandstype van foto's, een honeypot-veld en rate limits.
- Alleen verzoeken van de eigen site (`Origin` en `Sec-Fetch-Site`); geen CORS.
- Strikte Content-Security-Policy zonder inline scripts, `Referrer-Policy: no-referrer`, HSTS.
- De container draait als gebruiker `node`, read-only, zonder extra Linux-capabilities. Er zitten geen
  geheimen in het image of in build-argumenten.
- Afhankelijkheden: lockfile met `npm ci`, wekelijkse updates via Dependabot (npm, Docker, GitHub Actions),
  alle Actions vastgezet op een commit-SHA, `npm audit` en CodeQL in CI.
  `npm audit` meldt 4 bekende *moderate* adviezen in `workbox-build` (via `vite-plugin-pwa`). Die worden alleen
  tijdens het bouwen gebruikt en zitten niet in het image; CI faalt pas vanaf *high*.
- Het image heeft provenance en een SBOM. Controleren:

  ```bash
  gh attestation verify oci://ghcr.io/silkepilon/werkplekinspectie:latest --owner SilkePilon
  ```

- Deze repository bevat **geen bedrijfsgegevens**: geen logo, adres, namen of echte e-mailadressen. Alles
  wat bij een organisatie hoort komt uit de configuratie (Secret, ConfigMap en het gemounte logo). Voorbeelden
  gebruiken `example.com`, `Voorbeeld B.V.` en `J. Jansen`.

## Licentie

[MIT](LICENSE). De PDF gebruikt het lettertype Noto Sans (SIL Open Font License 1.1); de lettertypebestanden en
hun licentie staan in [`src/server/pdf/fonts/`](src/server/pdf/fonts/OFL.txt).
