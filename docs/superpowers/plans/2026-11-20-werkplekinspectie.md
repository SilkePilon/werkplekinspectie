# Werkplekinspectie PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Dutch, installable PWA in which field technicians fill in, review, sign and send the "Werkplekinspectie Arbo en Milieu"; a small server turns it into a landscape A4 PDF, mails it over SMTP and keeps nothing.

**Architecture:** One Node package, one container. `src/shared` holds the question list and the zod submission schema that the client, the validation and the PDF all use. `src/server` is a Fastify app with a single write route, `POST /api/inspecties`. It validates the submission, renders the PDF with pdfkit, sends it with nodemailer and also serves the Vite-built SPA. `src/client` is a React SPA with one thing per screen, Duolingo-style. Drafts and the outbox live in IndexedDB.

**Tech Stack:**
- **Runtime and languages:** Node 26 (Docker `node:26-alpine`), TypeScript.
- **Server:** Fastify 5, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/static`, zod 4, pdfkit + svg-to-pdfkit, nodemailer 10.
- **Client:** Vite 8, React 19, Tailwind CSS 4 (`@tailwindcss/vite`), `@radix-ui/react-dialog` via a shadcn-style `ui/` folder, signature_pad 5, browser-image-compression, idb-keyval, vite-plugin-pwa, `@fontsource-variable/nunito`.
- **Tests:** Vitest with jsdom, @testing-library/react, fake-indexeddb, unpdf.

**Spec:** `docs/superpowers/specs/2026-11-20-werkplekinspectie-design.md`

## Global Constraints

- UI language is Dutch at A2/B1 level. Use these exact words everywhere:
  - Answers: "Ja", "Nee", "Niet van toepassing" (shown as "Nvt" in counters).
  - Buttons: "Start inspectie", "Volgende", "Doorgaan", "Overslaan", "Aanpassen", "Alles klopt, naar tekenen", "Verstuur inspectie", "Opnieuw proberen", "Later versturen", "Klaar".
  - Success title: "Verstuurd!".
- The 21 question ids are `1A 1B 1C 1D 2A 2B 2C 3A 3B 4A 4B 4C 5A 6A 7A 7B 8A 8B 8C 9A 9B`. The app shows the spec §5 "Vraag in de app" text; the PDF shows the "Origineel" text.
- Colours (Tailwind `@theme` tokens):
  - Text: `ink #26193C`.
  - Brand: `violet #431961`, `violet-d #26193C`, `lila #EFE9F7`.
  - Nee and errors only: `coral #F34842`, `coral-d #C42B24`, `roze #FDECEB`.
  - Neutrals: `grey #E5E5E5`, `grey-d #C9C9C9`, `sub #5F5670`.
- Shapes and sizes:
  - Radius 16px on buttons and inputs; chunky buttons have a 5px bottom border.
  - Answer buttons are at least 62px tall; primary buttons at least 56px.
  - Question text is about 25px, weight 900.
- Nunito is self-hosted: no request to Google Fonts in production. Light theme only.
- The repo must not contain the client's logo, company address, any personal names or any real email addresses. All of these come from env or mounted files. Example values use `example.com`, `J. Jansen` and `Voorbeeld B.V.`.
- The server writes nothing to disk. Logs contain no submission content: only status, duration, byte size and a request id.
- The service worker never caches `/api/*`.
- Limits:
  - Text lengths: monteur ≤ 80, project ≤ 120, projectnummer ≤ 40, Nee comment 1–1000, goodPractice ≤ 2000.
  - Photos: ≤ 3 per Nee item, ≤ 15 in total, each ≤ 1.5 MB decoded, JPEG or PNG only, compressed on the phone to max 1600px at quality 0.7.
  - Signature: PNG ≤ 300 KB.
  - Request body ≤ 12 MB.
- Rate limits:
  - Per IP: `RATE_LIMIT_PER_IP` (default 5) per `RATE_LIMIT_WINDOW` (default `15 minutes`).
  - Global: `RATE_LIMIT_GLOBAL_PER_HOUR` (default 20).
- SMTP requires TLS 1.2 or higher and never sets `rejectUnauthorized: false`.

## Review Focus

1. **Sending from the outbox days later.** An inspection signed on Monday with "Opgelost vóór" set to Tuesday, sent from the outbox on Thursday, must still be accepted. "Not in the past" is checked against the inspection date (`startedAt`), not against the server's clock. Pinned in Task 2.
2. **Double tap or retry after a lost response.** Tapping "Verstuur inspectie" twice, or retrying after a timeout where the server did send the mail, must produce exactly one email. The client sends a stable `submissionId` and the server remembers ids it has already sent. Pinned in Tasks 7 and 13.
3. **Changing Nee to Ja.** If a technician answers Nee, fills in details, then changes it to Ja, the submission must contain no Nee details or photos for that item, and the summary must show Ja. Pinned in Task 10.
4. **Hostile or odd text.** A project named `<b>X</b>\r\nBcc: a@b.c` or a comment containing `<script>` must be escaped in the mail HTML, have its CR/LF stripped in the subject, and be printed literally in the PDF. Pinned in Task 6.
5. **Very long text in the PDF.** A 1000-character comment on several items and a 120-character project name must wrap inside the cells, and the table must continue onto the next page with a repeated header row. Nothing may be clipped or overlap. Pinned in Task 5.

---

## File structure

```
package.json, tsconfig.json, tsconfig.server.json, vite.config.ts, eslint.config.js, .env.example, index.html
src/shared/questions.ts        QUESTIONS, SECTIONS, QuestionId (single source of truth)
src/shared/schema.ts           submissionSchema (zod), LIMITS, Submission type
src/server/config.ts           loadConfig(env) -> Config
src/server/images.ts           decodeDataUrl, sniffImage
src/server/pdf/render.ts       renderInspectionPdf(sub, branding) -> Promise<Buffer>
src/server/pdf/layout.ts       column widths, row-height measuring, page-break helpers
src/server/mail/build.ts       buildMail(sub, pdf, cfg) -> MailMessage; escapeHtml; subjectLine
src/server/mail/send.ts        createMailer(cfg) -> { send(msg), verify() }
src/server/security.ts         clientKey(), originGuard(), createGlobalLimiter(), createSeenIds()
src/server/app.ts              buildApp(cfg, deps) -> FastifyInstance
src/server/index.ts            entrypoint
src/client/main.tsx, App.tsx   screen machine + history sync
src/client/styles.css          Tailwind import, @theme tokens, Nunito
src/client/ui/*                ChunkyButton, AnswerOption, ProgressBar, Sheet (Radix dialog), SectionIcon, cn.ts
src/client/state/draft.ts      Draft type, draftReducer, toSubmission()
src/client/storage/db.ts       draft / outbox / remembered-name persistence (idb-keyval)
src/client/photos/compress.ts  compressPhoto(file) -> Promise<string>
src/client/api/submit.ts       submitInspection(sub) -> Promise<SubmitResult>
src/client/screens/*           Start, Question, NeeSheet, GoodPractice, Summary, Signature, Result
public/icons/*                 neutral PWA icons (generated in Task 14)
Dockerfile, .dockerignore, deploy/k8s/*.yaml, .github/workflows/{ci,docker}.yml, .github/dependabot.yml, README.md
test/**                        mirrors src/**
```

---

### Task 1: Project scaffold and toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `.env.example`, `src/client/main.tsx` (placeholder), `test/smoke.test.ts`
- Modify: `.gitignore` (already ignores node_modules, dist, .env)

**Interfaces:**
- Produces these npm scripts:
  - `dev`: Vite with a proxy for `/api` to `:8080`.
  - `dev:server`: tsx watch on `src/server/index.ts`.
  - `build`: `vite build`, which writes `dist/client`, then `tsc -p tsconfig.server.json`, which writes `dist/server`.
  - `start`: `node dist/server/server/index.js`.
  - `test`: `vitest run`.
  - `lint`: `eslint .`.
  - `typecheck`: `tsc --noEmit` and `tsc -p tsconfig.server.json --noEmit`.
- Client code imports shared code via the alias `@shared/*` → `src/shared/*` (tsconfig + Vite). Server code imports shared code by **relative path**; `tsconfig.server.json` has `rootDir: "src"`, `include: ["src/server","src/shared"]`, `outDir: "dist/server"`, so the entry compiles to `dist/server/server/index.js`.
- Vitest uses `environment: 'node'` by default and jsdom only for `test/client/**` (`environmentMatchGlobs` or a per-file `// @vitest-environment jsdom`).

- [ ] **Step 1:** Run `npm init` and install exact current majors:
  - runtime: fastify, @fastify/rate-limit, @fastify/helmet, @fastify/static, zod, pdfkit, svg-to-pdfkit, nodemailer, proxy-addr
  - client: react, react-dom, @radix-ui/react-dialog, signature_pad, browser-image-compression, idb-keyval, @fontsource-variable/nunito, clsx, tailwind-merge
  - dev: typescript, vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, vite-plugin-pwa, vitest, jsdom, @testing-library/react, @testing-library/user-event, fake-indexeddb, unpdf, tsx, eslint, typescript-eslint, eslint-plugin-react-hooks, @types/*

  Set `"engines": {"node": ">=24"}` and `"type": "module"`.
- [ ] **Step 2:** Write `test/smoke.test.ts` asserting `1 + 1 === 2`. Run `npm test` and expect PASS. This proves Vitest is wired up.
- [ ] **Step 3:** Write `.env.example` with every variable from spec §11, plus `PUBLIC_ORIGIN=https://inspectie.example.com` and `NODE_ENV=production`. Use only example values (`vgm@example.com`, `J. Jansen`, `Voorbeeld B.V.`).
- [ ] **Step 4:** Run `npm run lint && npm run typecheck && npx vite build`. All must succeed on the placeholder app.
- [ ] **Step 5:** Commit: `chore: scaffold vite + fastify + vitest`.

### Task 2: Shared questions and submission schema

**Files:**
- Create: `src/shared/questions.ts`, `src/shared/schema.ts`
- Test: `test/shared/questions.test.ts`, `test/shared/schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type QuestionId = '1A'|'1B'|…|'9B';
  interface Section { nr: 1|…|9; title: string; formTitle: string; icon: SectionIconName }
  interface Question { id: QuestionId; section: Section['nr']; appText: string; formText: string }
  const SECTIONS: readonly Section[]; const QUESTIONS: readonly Question[];
  ```
  - `title` is the short app name (e.g. "Gereedschap").
  - `formTitle` is the form wording (e.g. "Gereedschappen en klimmaterieel").
  - `SectionIconName = 'instructie'|'werkomgeving'|'gereedschap'|'brand'|'pbm'|'werk'|'hygiene'|'milieu'|'ehbo'`.
  ```ts
  const LIMITS = { monteur:80, project:120, projectnummer:40, comment:1000, goodPractice:2000,
    photosPerItem:3, photosTotal:15, photoBytes:1_500_000, signatureBytes:300_000, bodyBytes:12_000_000 } as const;
  type Answer = { answer:'ja' } | { answer:'nvt' } |
    { answer:'nee'; comment:string; actionBefore:string /*YYYY-MM-DD*/; photos:string[] /*data URLs*/ };
  interface Submission { submissionId:string /*uuid*/; monteur:string; project:string; projectnummer:string;
    startedAt:string /*ISO*/; signedAt:string /*ISO*/; answers: Record<QuestionId, Answer>;
    goodPractice:string; signature:string /*data:image/png*/; declaration:true; website?:string /*honeypot*/ }
  const submissionSchema: z.ZodType<Submission>;
  ```
- The schema checks shapes and sizes only: data-URL prefix, base64 length ≤ limit. Magic-byte checks happen on the server (Task 4).

- [ ] **Step 1: Write the failing tests.** In `questions.test.ts`:
  - `QUESTIONS.length === 21`.
  - The ids match the Global Constraints list in that order.
  - Every `section` exists in `SECTIONS`.
  - `QUESTIONS.find(q=>q.id==='1D').appText === 'Heb je je LMRA-kaart bij je?'`.
  - `formText` for 1D is `'LMRA pas voorhanden'`.

  In `schema.test.ts`, using a `validSubmission()` fixture:
  - accepts the fixture;
  - rejects a missing id, an extra unknown id, and `answer:'misschien'`;
  - rejects `nee` with an empty comment, and a comment of 1001 chars;
  - rejects 4 photos on one item, and 16 photos in total;
  - rejects `declaration:false`, and a signature that isn't `data:image/png;base64,`;
  - rejects unknown top-level keys (strict);
  - Review Focus 1: rejects `actionBefore` earlier than the date part of `startedAt` in Europe/Amsterdam;
  - Review Focus 1: **accepts** `startedAt:'2026-11-16T08:00:00+01:00'` with `actionBefore:'2026-11-17'`, regardless of the current date.
- [ ] **Step 2:** Run `npx vitest run test/shared`. Expect FAIL (modules missing).
- [ ] **Step 3:** Implement both files.
  - Copy the 21 app and form texts verbatim from the table in spec §5, and the section titles from spec §5 "Onderdelen".
  - Build the schema with zod 4 `z.strictObject`; check the date rule with `superRefine`.
  - Compute the Amsterdam date with `Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'})`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(shared): questions and submission schema`.

### Task 3: Server configuration

**Files:**
- Create: `src/server/config.ts`
- Test: `test/server/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Config { port:number; publicOrigin:string; trustProxy:string[];
    mail:{ to:string; from:string; smtp:{ host:string; port:number; secure:boolean; user:string; pass:string } };
    branding:{ orgName:string; orgAddress:string[]; department:string; vgmName:string; logoFile?:string };
    rateLimit:{ perIp:number; window:string; globalPerHour:number } }
  function loadConfig(env: NodeJS.ProcessEnv): Config  // throws ConfigError listing ALL missing/invalid vars
  ```
- Required variables: `MAIL_TO`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `PUBLIC_ORIGIN`.
- Defaults:
  - `PORT` 8080.
  - `SMTP_PORT` 465; `SMTP_SECURE` is true when the port is 465.
  - `ORG_NAME` and `ORG_ADDRESS` default to `''`.
  - `ORG_DEPARTMENT` defaults to `'Customer Care'`.
  - `VGM_NAME` defaults to `''`.
  - `TRUST_PROXY` is a comma-separated CIDR list, default `[]`.
  - Rate limits default to 5, `'15 minutes'` and 20.
- `ORG_ADDRESS` is split on the literal `\n`.

- [ ] **Step 1: Write the failing tests.**
  - A full env produces the expected `Config`.
  - An empty env throws, and the message lists all six required names.
  - `MAIL_TO='a@b.c, d@e.f'` is rejected: exactly one address.
  - `PUBLIC_ORIGIN='http://x'` is rejected unless `NODE_ENV !== 'production'`.
  - `SMTP_PORT=587` gives `secure:false`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement with a zod schema over `env`.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(server): env config loader`.

### Task 4: Image decoding and sniffing

**Files:**
- Create: `src/server/images.ts`
- Test: `test/server/images.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ImageKind = 'jpeg'|'png';
  function decodeDataUrl(url:string): { kind: ImageKind; data: Buffer }  // throws InvalidImageError
  ```
- Decide the kind from the magic bytes, not from the MIME prefix:
  - JPEG: `FF D8 FF`.
  - PNG: `89 50 4E 47 0D 0A 1A 0A`.

- [ ] **Step 1: Write the failing tests.**
  - A tiny real PNG (a 1×1 fixture as base64) gives `kind:'png'`.
  - A JPEG fixture gives `'jpeg'`.
  - `data:image/png;base64,` followed by GIF bytes throws.
  - Non-base64 garbage throws.
  - A string without a `data:` prefix throws.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(server): data-url image decoding with magic-byte check`.

### Task 5: PDF renderer

**Files:**
- Create: `src/server/pdf/render.ts`, `src/server/pdf/layout.ts`
- Test: `test/server/pdf.test.ts`, `test/fixtures/submission.ts` (shared fixture builder, reused by Tasks 6–7)

**Interfaces:**
- Consumes: `Submission`, `QUESTIONS`, `SECTIONS` (Task 2); `decodeDataUrl` (Task 4); `Config['branding']` (Task 3).
- Produces:
  ```ts
  function renderInspectionPdf(sub: Submission, branding: Config['branding'], logo?: Buffer, logoKind?: 'svg'|'png'): Promise<Buffer>
  function pdfFileName(sub: Submission): string
  ```
  `pdfFileName` returns `Werkplekinspectie {YYYY}-{project}-{YYYY-MM-DD}.pdf`, with the project sanitised to `[A-Za-z0-9 _-]` and capped at 60 characters.
- Fixture builder: `makeSubmission(overrides?: Partial<Submission>, opts?: { neeIds?: QuestionId[]; photosPerNee?: number }): Submission`.

Layout follows spec §7:
- Page: landscape A4, Helvetica (WinAnsi covers ë).
- Header: logo, title, the address block from `branding`, "Origineel: Afdeling {department}", "Kopie: VG functionaris", "Reg:", Project, Projectnummer.
- Signature block:
  - Inspectie uitgevoerd door: monteur and `startedAt`.
  - Handtekening monteur: the signature PNG and `signedAt`.
  - "VGM functionaris: {vgmName}" with an empty paraaf box.
  - Afmelding: empty.
- "Wat gaat hier goed…" with its text.
- The main table:
  - Columns: Omschrijving, Ja, Nee, Nvt, Commentaar, Vastgesteld door, Actie vóór, Actie uitgevoerd door, Uitgevoerd.
  - One section heading row per section, using `formTitle`.
  - "X" in the chosen column.
  - "Vastgesteld door" = monteur on Nee items only.
  - Rows grow to fit wrapped text, and the header row repeats on every new page.
- "Te nemen actie op punt: 3A, 4B".
- Photo pages: two photos per page, each captioned with id + `formText`.
- Footer on every page: "Internal", "Blad n", and "Digitaal ingevuld en ondertekend via de Werkplekinspectie-app op {signedAt dd-mm-yyyy HH:mm}".
- Format dates in Europe/Amsterdam.
- Use `svg-to-pdfkit` when the logo kind is `'svg'`.

- [ ] **Step 1: Write the failing tests.** Extract text with `unpdf` `extractText`.
  - It contains "Werkplekinspectie Arbo en Milieu", every `formText`, and the monteur name.
  - It contains "Te nemen actie op punt: 3A, 4B" for `neeIds ['3A','4B']`.
  - With 2 photos per Nee item, the page count is at least table pages + 2.
  - Review Focus 5:
    - Three Nee items with 1000-char comments and a 120-char project render without throwing.
    - Each comment's last 20 chars appear in the extracted text, so nothing is clipped.
    - The page count is greater than 1, and "Omschrijving" appears once per table page.
  - Review Focus 4: a project `'<b>X</b>'` appears literally.
  - `pdfFileName` for project `'UMC / Utrecht'`, started 2026-11-20, gives `'Werkplekinspectie 2026-UMC Utrecht-2026-11-20.pdf'` (sanitiser: drop chars outside `[A-Za-z0-9 _-]`, collapse whitespace runs to one space, trim, cap 60).
  - Rendering with an empty `branding` (no logo, empty address) still works.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement. `layout.ts` owns column widths and the `measureRow(cells) -> height` / `ensureSpace(h)` page-break logic. `render.ts` owns the drawing order.
- [ ] **Step 4:** Run the tests. Expect PASS. Also write a sample to `/tmp/<scratch>/sample.pdf` with a throwaway script, convert page 1 to PNG (`pdftoppm` if available, otherwise skip) and look at it. Compare it with the original form's structure.
- [ ] **Step 5:** Commit: `feat(server): landscape inspection pdf`.

### Task 6: Mail building and sending

**Files:**
- Create: `src/server/mail/build.ts`, `src/server/mail/send.ts`
- Test: `test/server/mail.test.ts`

**Interfaces:**
- Consumes: `Submission` and `QUESTIONS` (Task 2), `Config` (Task 3), `pdfFileName` (Task 5).
- Produces:
  ```ts
  interface MailMessage { from:string; to:string; subject:string; text:string; html:string;
    attachments:{ filename:string; content:Buffer; contentType:'application/pdf' }[] }
  function buildMail(sub:Submission, pdf:Buffer, cfg:Config): MailMessage
  function escapeHtml(s:string): string
  interface Mailer { send(msg:MailMessage): Promise<void>; verify(): Promise<boolean> }
  function createMailer(cfg:Config['mail']): Mailer   // nodemailer transport; tls.minVersion 'TLSv1.2'; requireTLS when !secure
  ```
- Subject: `Werkplekinspectie – {project} ({projectnummer}) – {dd-mm-yyyy}`. Collapse `\r` and `\n` to spaces and cap the subject at 200 chars.
- Body: monteur, project, date, counts in the form "19 × Ja, 2 × Nee, 0 × Nvt", then each Nee item as `id appText`, comment, "Opgelost vóór dd-mm-yyyy". Plain text and HTML carry the same content.

- [ ] **Step 1: Write the failing tests.**
  - `to` and `from` come only from `cfg`. A submission whose project contains an email address does not change them.
  - The attachment `filename` is `pdfFileName(sub)`.
  - Review Focus 4:
    - A project `'<b>X</b>\r\nBcc: a@b.c'` gives a subject with no `\r` or `\n`.
    - The HTML contains `&lt;b&gt;X&lt;/b&gt;`.
    - A comment `<script>alert(1)</script>` appears escaped in the HTML.
  - The counts line is correct for a fixture with 2 × Nee.
  - `createMailer` passes `tls.minVersion:'TLSv1.2'` and never sets `rejectUnauthorized:false`. Assert on the options captured with a `vi.mock('nodemailer')` spy.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(server): mail composition and smtp sender`.

### Task 7: Fastify app with the submit route

**Files:**
- Create: `src/server/app.ts`, `src/server/index.ts`, `src/server/security.ts` (only `createSeenIds` here; signature in Task 8 Interfaces, TTL 24h)
- Test: `test/server/app.test.ts` (uses `app.inject`)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  ```ts
  interface AppDeps { mailer: Mailer; renderPdf?: typeof renderInspectionPdf; now?: () => Date; logo?: { data:Buffer; kind:'svg'|'png' }; staticRoot?: string /* default dist/client */ }
  function buildApp(cfg:Config, deps:AppDeps): Promise<FastifyInstance>
  ```
- Routes:
  - `POST /api/inspecties`:
    - Body is a `Submission` (JSON).
    - On success, `200 {status:'verzonden'}`.
    - `400 {status:'ongeldig', fields:string[]}` lists the zod paths.
    - `413` for oversize bodies.
    - `502 {status:'mail_mislukt'}` if SMTP fails.
  - `GET /healthz` returns `200 ok`.
  - `GET /api/branding` returns `{ hasLogo:boolean }`.
  - `GET /api/branding/logo` serves the logo with its content type, or 404.
  - Static files are served from `dist/client`, with an SPA fallback to `index.html` for non-`/api` GETs.
- Processing order for a submit:
  1. zod parse.
  2. Decode every image with `decodeDataUrl` and enforce the byte limits.
  3. Check `submissionId` against the seen-ids set; if already seen, return 200 without sending (Review Focus 2).
  4. Render the PDF, send the mail.
  5. Mark the id as seen, only after a successful send.
  6. Drop all references.
- No submission content is logged. Use a custom Fastify logger serializer that logs only method, url, status, `responseTime` and `content-length`.
- `index.ts`:
  - `loadConfig(process.env)`.
  - Read `BRAND_LOGO_FILE` once at startup.
  - Call `mailer.verify()` and only log the result.
  - `listen({ host:'0.0.0.0', port })`.
  - Shut down gracefully on SIGTERM.

- [ ] **Step 1: Write the failing tests.** Use a fake mailer that records messages and a stub `renderPdf`.
  - A valid submission gives 200, and the mailer received 1 message with a PDF attachment.
  - An invalid body gives 400, `fields` includes `answers.4B.comment`, and the mailer was not called.
  - Review Focus 2: posting the same `submissionId` twice gives 200 both times and the mailer is called once.
  - When the mailer throws, the response is 502. A retry with the same id then sends, because the id was not marked.
  - A photo whose MIME prefix says PNG but whose bytes are GIF gives 400.
  - `GET /healthz` gives 200.
  - `GET /api/branding/logo` without a logo gives 404.
  - `GET /some/route` serves `index.html` from a temp dir passed as `staticRoot` (created in `beforeAll` with a one-line `index.html`).
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(server): submit route, health, branding, static`.

### Task 8: Security hardening

**Files:**
- Create: `src/server/security.ts`
- Modify: `src/server/security.ts`, `src/server/app.ts`
- Test: `test/server/security.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function clientKey(req: FastifyRequest, trusted: string[]): string    // CF-Connecting-IP only if socket peer ∈ trusted CIDRs (proxy-addr compile), else socket address
  function originGuard(publicOrigin: string): onRequestHookHandler      // POST /api/*: Origin must === publicOrigin; Sec-Fetch-Site, if present, must be 'same-origin'; else 403
  function createGlobalLimiter(maxPerHour: number, now: () => number): { take(): boolean }
  function createSeenIds(ttlMs: number, now: () => number): { has(id:string):boolean; add(id:string):void }  // created in Task 7
  ```
- Registration in `buildApp`:
  - `@fastify/helmet` with the spec §10 CSP: `default-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`.
  - Also `referrerPolicy: no-referrer` and HSTS.
  - A `Permissions-Policy: camera=(), microphone=(), geolocation=()` header.
  - `@fastify/rate-limit` on the submit route with `keyGenerator: req => clientKey(req, cfg.trustProxy)`. A 429 returns `{status:'te_veel'}`.
  - The global limiter runs after the per-IP limit and also returns 429 `te_veel`.
  - `bodyLimit: LIMITS.bodyBytes` on the route.
  - Only `application/json` is accepted.
- Honeypot: if `website` is a non-empty string, return 200 `{status:'verzonden'}`, send nothing and log `honeypot` without content. This check runs before zod.

- [ ] **Step 1: Write the failing tests** (with `inject`).
  - The 6th POST from the same `cf-connecting-ip` via a trusted peer gives 429 when `perIp=5`. The `remoteAddress` inject option is set to an address in `TRUST_PROXY`.
  - From an untrusted peer, varying `cf-connecting-ip` does not reset the limit: the key is the peer address.
  - With `globalPerHour=2`, the 3rd request from 3 different IPs gives 429.
  - An `Origin` that is not `publicOrigin` gives 403. `Sec-Fetch-Site: cross-site` gives 403.
  - `content-type: text/plain` gives 415.
  - A body over 12 MB gives 413.
  - The honeypot case gives 200 and the mailer is not called.
  - A response from `/` has a `content-security-policy` header containing `frame-ancestors 'none'`.
  - `createSeenIds` forgets ids after the TTL (24h).
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full server suite with `npx vitest run test/server`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(server): rate limits, origin guard, honeypot, security headers`.

### Task 9: Client foundation (tokens, UI kit, shell)

**Files:**
- Create: `src/client/styles.css`, `src/client/ui/cn.ts`, `src/client/ui/ChunkyButton.tsx`, `src/client/ui/AnswerOption.tsx`, `src/client/ui/ProgressBar.tsx`, `src/client/ui/Sheet.tsx`, `src/client/ui/SectionIcon.tsx`, `src/client/App.tsx`
- Modify: `src/client/main.tsx`, `index.html` (`lang="nl"`, theme-color `#431961`)
- Test: `test/client/ui.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  <ChunkyButton variant="main"|"coral"|"line"|"ghost" disabled? busy? onClick>  // ≥56px; busy shows spinner + aria-busy
  <AnswerGroup name legend value onChange(value:'ja'|'nee'|'nvt')>               // fieldset/legend + native radio inputs styled as 3 options ≥62px, icon + text
  <ProgressBar value={0..1} label="Vraag 12 van 21" />                            // role=progressbar, aria-valuenow
  <Sheet open onOpenChange title>                                                 // Radix Dialog as bottom sheet, focus-trapped
  <SectionIcon name={SectionIconName} />                                          // inline SVG line icons, stroke 2.2, currentColor
  ```
- The visual reference is `docs/design/mockups/flow-vragen.html` and `flow-einde.html`. Match their sizes, colours, the chunky 5px bottom borders and the selected states:
  - Ja selected: lila background, violet border and text, filled violet icon box.
  - Nee selected: roze background, coral border and coral-d text.
  - Nvt selected: grey-d border with a grey background.
- Nunito is imported from `@fontsource-variable/nunito`. Respect `prefers-reduced-motion`.

- [ ] **Step 1: Write the failing tests.**
  - `AnswerGroup` renders 3 radios with accessible names "Ja", "Nee" and "Niet van toepassing".
  - Clicking "Nee" calls `onChange('nee')`.
  - Arrow keys move the selection: native radio behaviour.
  - `ChunkyButton busy` is disabled and has `aria-busy="true"`.
  - `ProgressBar` exposes `aria-valuenow`.
- [ ] **Step 2:** Run `npx vitest run test/client/ui.test.tsx`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expect PASS. Then run `npx vite build` and expect success.
- [ ] **Step 5:** Commit: `feat(client): design tokens and ui kit`.

### Task 10: Draft state and on-device storage

**Files:**
- Create: `src/client/state/draft.ts`, `src/client/storage/db.ts`
- Test: `test/client/draft.test.ts`, `test/client/db.test.ts` (with `fake-indexeddb/auto`)

**Interfaces:**
- Produces:
  ```ts
  interface NeeDetails { comment:string; actionBefore:string; photos:string[] }
  interface Draft { id:string /*= submissionId, crypto.randomUUID()*/; monteur:string; project:string; projectnummer:string;
    startedAt:string; updatedAt:string; answers: Partial<Record<QuestionId,'ja'|'nee'|'nvt'>>;
    nee: Partial<Record<QuestionId, NeeDetails>>; goodPractice:string; signature?:string; signedAt?:string; declaration:boolean }
  type DraftAction =
    | {type:'answer'; id:QuestionId; value:'ja'|'nee'|'nvt'} | {type:'neeDetails'; id:QuestionId; details:Partial<NeeDetails>}
    | {type:'goodPractice'; text:string} | {type:'sign'; signature:string; at:string} | {type:'declare'; value:boolean}
    | {type:'header'; monteur?:string; project?:string; projectnummer?:string}
  function newDraft(monteur:string, project:string, projectnummer:string, now:Date): Draft
  function draftReducer(d:Draft, a:DraftAction): Draft          // also sets updatedAt
  function toSubmission(d:Draft): Submission                     // throws if incomplete
  function nextUnanswered(d:Draft): QuestionId | null
  function counts(d:Draft): { ja:number; nee:number; nvt:number }

  // db.ts
  saveDraft(d:Draft):Promise<void>; loadDraft():Promise<Draft|null>; clearDraft():Promise<void>
  addToOutbox(s:Submission):Promise<void>; listOutbox():Promise<Submission[]>; removeFromOutbox(id:string):Promise<void>
  purgeExpired(now:Date):Promise<void>   // drops the in-progress draft if updatedAt older than 14 days; never touches the outbox
  getRememberedName():Promise<string>; setRememberedName(n:string):Promise<void>
  ```
- The `nee` details are kept in the draft when an answer is switched back to Ja. That way switching back to Nee restores them, but `toSubmission` only emits them for items whose current answer is `nee`.

- [ ] **Step 1: Write the failing tests.**
  - Review Focus 3: answer 4B nee, add details with a photo, answer 4B ja. Then `toSubmission(d).answers['4B']` deep-equals `{answer:'ja'}`. Switching back to nee restores the previous comment.
  - `toSubmission` output passes `submissionSchema.parse`.
  - `toSubmission` throws when a question is unanswered, or a nee item lacks a comment or date.
  - `nextUnanswered` returns `'1A'` on a new draft and `null` when all are answered.
  - `counts` is correct.
  - db: a saved draft round-trips including photos.
  - db: `purgeExpired` with updatedAt 15 days old clears the draft and keeps 2 outbox items.
  - db: `removeFromOutbox` removes only that id.
  - db: the remembered name survives `clearDraft`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement. Use idb-keyval keys `draft`, `outbox`, `monteur` in a custom store `createStore('werkplekinspectie','kv')`. Call `navigator.storage?.persist?.()` once, best-effort.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(client): draft reducer and indexeddb storage`.

### Task 11: Start screen and question flow

**Files:**
- Create: `src/client/screens/StartScreen.tsx`, `src/client/screens/QuestionScreen.tsx`, `src/client/screens/NeeSheet.tsx`, `src/client/photos/compress.ts`
- Modify: `src/client/App.tsx` (screen machine, autosave, history sync)
- Test: `test/client/flow-questions.test.tsx`, `test/client/compress.test.ts`

**Interfaces:**
- Consumes: Tasks 9 and 10.
- Produces the screen machine in `App.tsx`:
  ```ts
  type Screen = {name:'start'} | {name:'question'; id:QuestionId; returnTo?:'summary'} | {name:'goodPractice'}
    | {name:'summary'} | {name:'signature'} | {name:'result'; outcome:SubmitOutcome}
  ```
  - Every screen change calls `history.pushState`, and `popstate` goes to the previous screen, so the phone's back button works.
  - The draft is autosaved, debounced at about 300ms, after every action.
- `compressPhoto(file: File): Promise<string>` calls browser-image-compression with `{maxWidthOrHeight:1600, initialQuality:0.7, fileType:'image/jpeg', useWebWorker:true}` and returns a data URL. If decoding fails it throws `PhotoError` with the message "Deze foto kan niet gebruikt worden. Maak een nieuwe foto."
- Start screen shows the configured logo (`<img src="/api/branding/logo" alt="">`) only when `GET /api/branding` returns `hasLogo:true`; otherwise just the title "Werkplekinspectie".
- Copy:
  - **Start:**
    - Greeting "Hoi {naam}!" when a name is remembered; otherwise a "Naam" field.
    - Fields "Project" and "Projectnummer".
    - Hint "21 korte vragen. Duurt ongeveer 5 minuten."
    - Resume card "Je bent nog bezig met een inspectie" with "Verder gaan" / "Weggooien". "Weggooien" asks for confirmation.
    - An outbox list "Nog te versturen" with "Nu versturen" per item (wired in Task 13).
  - **Question:**
    - Section icon and section `title` above the question.
    - X button (goes back to start; the draft stays), progress "Vraag n van 21".
  - **NeeSheet:**
    - Title "Wat is er mis?".
    - Fields "Wat is er mis?" (textarea), "Opgelost vóór" (native `type=date`, min = date of `startedAt`) and "Foto" (≤ 3, removable thumbnails).
    - Button "Doorgaan". Its errors are inline Dutch, e.g. "Schrijf kort op wat er mis is." and "Kies een datum."
- Behaviour:
  - Tapping Ja or Nvt shows the selected state, then advances after 300ms. With reduced motion it advances at once.
  - Tapping Nee opens the sheet. "Doorgaan" is valid only when comment and date are filled; then the flow advances.
  - Closing the sheet without valid details keeps the answer at Nee but marks the item incomplete. The summary flags it, and `toSubmission` blocks the send.
  - When `returnTo:'summary'`, finishing the item returns to the summary instead of advancing.
  - After 9B comes `goodPractice`.

- [ ] **Step 1: Write the failing tests** (RTL with fake timers and fake-indexeddb):
  - Fill the start screen and click "Start inspectie". The question 1A text "Heb je het VGM-handboekje bij je?" is visible.
  - Click "Ja", advance 300ms: 1B is visible.
  - Answer 1B Nee: the dialog "Wat is er mis?" opens. "Doorgaan" with an empty comment shows "Schrijf kort op wat er mis is." Fill comment and date, click "Doorgaan": 1C is visible.
  - Reload: unmount and remount `<App/>`. The start screen shows "Je bent nog bezig met een inspectie". "Verder gaan" opens 1C, the first unanswered question.
  - `history.back()` from 1C shows 1B.
  - `compressPhoto` with a mocked library returns a `data:image/jpeg` URL. When the library rejects, it throws `PhotoError`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(client): start screen, question flow, nee sheet, photos`.

### Task 12: Good-practice, summary and signature screens

**Files:**
- Create: `src/client/screens/GoodPracticeScreen.tsx`, `src/client/screens/SummaryScreen.tsx`, `src/client/screens/SignatureScreen.tsx`
- Modify: `src/client/App.tsx`
- Test: `test/client/flow-end.test.tsx` (mock `signature_pad`: jsdom has no canvas)

**Interfaces:**
- Consumes: Tasks 10 and 11.
- Copy (spec §5 and mockup `flow-einde.html`):
  - **GoodPractice:**
    - Label "Nog één vraag".
    - Question "Wat gaat hier goed? Waar kan de rest van het bedrijf van leren?"
    - Hint "Mag kort. Je mag dit ook overslaan."
    - Buttons "Volgende" and "Overslaan".
  - **Summary:**
    - Title "Klopt alles?" with chips "n × Ja / n × Nee / n × Nvt".
    - Section "Niet in orde" with Nee cards: id + appText, comment, "Vóór d mmm, n foto('s)", and "Aanpassen". Incomplete Nee items get the error text "Nog niet compleet".
    - Section "Alle onderdelen" with rows per section; tapping a row opens that section's first question with `returnTo:'summary'`.
    - A "Wat gaat hier goed?" row.
    - Button "Alles klopt, naar tekenen", disabled with an explanation while anything is incomplete.
  - **Signature:**
    - Title "Zet je handtekening".
    - A canvas with "Opnieuw" (clear), and "{monteur}, {d mmm yyyy}" under the line.
    - Checkbox "Ik heb deze inspectie zelf gedaan en de antwoorden kloppen."
    - Button "Verstuur inspectie", enabled only when the pad is not empty and the checkbox is ticked.
    - The canvas is scaled by devicePixelRatio and strokes are preserved on resize (`toData`/`fromData`). Export with `toDataURL('image/png')`.

- [ ] **Step 1: Write the failing tests.**
  - From a fully answered draft with 4B nee, the summary lists "4B" under "Niet in orde".
  - "Aanpassen" on 4B, change to Ja, advance: back on the summary, which now shows "0 × Nee". This also covers Review Focus 3 end to end.
  - Tapping row "4 Brandpreventie" opens 4A with `returnTo` summary.
  - On the signature screen, the send button is disabled until the mock pad reports non-empty and the box is ticked.
  - "Overslaan" on goodPractice leads to the summary, with goodPractice `''`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit: `feat(client): summary with edit, good-practice and signature screens`.

### Task 13: Sending, result screens and outbox

**Files:**
- Create: `src/client/api/submit.ts`, `src/client/screens/ResultScreen.tsx`
- Modify: `src/client/App.tsx`, `src/client/screens/StartScreen.tsx`
- Test: `test/client/submit.test.ts`, `test/client/flow-send.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  type SubmitOutcome = 'verzonden' | 'offline' | 'te_veel' | 'ongeldig' | 'mail_mislukt' | 'onbekend'
  function submitInspection(s: Submission, opts?: { timeoutMs?: number /*30000*/ }): Promise<{ outcome: SubmitOutcome; fields?: string[] }>
  ```
  `fetch('/api/inspecties', {method:'POST', headers:{'content-type':'application/json'}, body})` maps:
  - network error or timeout → `offline`
  - 200 → `verzonden`
  - 429 → `te_veel`
  - 400 → `ongeldig`
  - 502 → `mail_mislukt`
  - any other status → `onbekend`
- Flow on "Verstuur inspectie":
  1. Sign the draft.
  2. Call `toSubmission`.
  3. **Add it to the outbox first, and clear the draft only after that write succeeds.**
  4. Send.
  5. On `verzonden`, remove it from the outbox.

  This ensures nothing is lost even if the app is killed mid-request. The same `submissionId` is used for every retry (Review Focus 2).
- **Result screens:**
  - `verzonden`: badge, "Verstuurd!", "De inspectie is gemaild naar de VGM-functionaris.", stat tiles (questions / keer Nee / foto's), button "Klaar".
  - `offline`: "Nog niet verstuurd", "Je hebt nu geen internet.", the reassurance "Je inspectie staat veilig op deze telefoon. Er gaat niets verloren.", and buttons "Opnieuw proberen" / "Later versturen".
  - `te_veel`: "Er zijn net te veel inspecties verstuurd. Probeer het over een kwartier opnieuw." with the same reassurance and buttons.
  - `mail_mislukt` and `onbekend`: "Versturen is niet gelukt. Probeer het later opnieuw." with the same reassurance and buttons.
  - `ongeldig`: "Er klopt iets niet in de inspectie." with "Aanpassen", which goes to the summary. Use the first entry of `fields` to highlight the item. The item is taken back out of the outbox into the draft.
- **Start screen outbox:**
  - Each item reads "{project}, {datum}" with "Nu versturen".
  - On the `online` event, show the banner "Je hebt weer internet. Je kunt je inspecties nu versturen."

- [ ] **Step 1: Write the failing tests.**
  - `submitInspection` maps each status above correctly (mock fetch). A rejected fetch gives `offline`. A hung fetch gives `offline` after `timeoutMs`.
  - Flow: with fetch rejecting, sending shows "Nog niet verstuurd" and the outbox has 1 item. "Later versturen" goes to start, which lists the item. With fetch then returning 200, "Nu versturen" shows "Verstuurd!" and the outbox is empty.
  - Review Focus 2: double-clicking "Verstuur inspectie" makes exactly one fetch call (busy state).
  - Both retries carry the same `submissionId`.
  - `verzonden` leaves no draft and an empty outbox.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full client suite with `npx vitest run test/client`. Expect PASS.
- [ ] **Step 5:** Commit: `feat(client): sending, result screens, outbox`.

### Task 14: PWA (manifest, icons, service worker, update prompt)

**Files:**
- Create: `public/icons/icon.svg` (neutral clipboard-with-check mark, white on violet `#431961`), generated PNGs `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`
- Modify: `vite.config.ts`, `src/client/screens/StartScreen.tsx`
- Test: `test/build/pwa.test.ts` (reads the build output)

**Interfaces:**
- vite-plugin-pwa config:
  - `registerType:'prompt'`, `injectRegister:'script'` (external file, CSP-safe).
  - Manifest: `name:'Werkplekinspectie'`, `short_name:'Inspectie'`, `lang:'nl'`, `display:'standalone'`, `theme_color:'#431961'`, `background_color:'#FFFFFF'`.
  - Workbox `navigateFallback:'/index.html'`, `navigateFallbackDenylist:[/^\/api\//]`.
  - Precache only built assets. No `runtimeCaching` for `/api`.
- Generate the icons with `@vite-pwa/assets-generator` (dev dependency) from `icon.svg`.
- The update prompt shows only on the start screen: "Er is een nieuwe versie. Vernieuwen" (uses `useRegisterSW` from `virtual:pwa-register/react`).
- On iOS Safari, when not in standalone mode, show a one-time hint on start: "Tip: zet de app op je beginscherm via Delen → Zet op beginscherm."

- [ ] **Step 1: Write the failing test.** After `npx vite build`:
  - `dist/client/manifest.webmanifest` has `lang:'nl'` and the icons.
  - `dist/client/sw.js` exists and does not contain the string `/api/inspecties`.
  - `dist/client/index.html` contains no inline `<script>` without `src`, which would break the CSP.
- [ ] **Step 2:** Run `npx vite build && npx vitest run test/build`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expect PASS.
- [ ] **Step 5:** Commit: `feat(pwa): manifest, icons, service worker, update prompt`.

### Task 15: Container, deployment manifests, CI and README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/k8s/deployment.yaml`, `deploy/k8s/service.yaml`, `deploy/k8s/secret.example.yaml`, `deploy/k8s/configmap.example.yaml`, `.github/workflows/ci.yml`, `.github/workflows/docker.yml`, `.github/dependabot.yml`, `README.md`, `LICENSE` (MIT)
- Test: CI itself, plus `test/build/server-start.test.ts`

**Interfaces:**
- **Dockerfile:** multi-stage on `node:26-alpine`.
  1. `deps` stage: `npm ci`.
  2. `build` stage: `npm run build`, then `npm prune --omit=dev`.
  3. Runtime stage: copy `dist/` and the production `node_modules`. Set `ENV NODE_ENV=production`, `USER node`, `EXPOSE 8080`, `CMD ["node","dist/server/server/index.js"]`.
  - No `ARG` for secrets. Add an OCI labels `org.opencontainers.image.source`.
- **Kubernetes manifests:**
  - Deployment with `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`.
  - An `emptyDir` on `/tmp`, used by pdfkit/nodemailer if needed.
  - Resource requests and limits: 100m/128Mi → 500m/384Mi.
  - Liveness and readiness probes on `/healthz`.
  - `envFrom` the Secret and ConfigMap. Logo mounted from the ConfigMap at `/config/logo.svg` and `BRAND_LOGO_FILE=/config/logo.svg`.
  - Example `TRUST_PROXY=10.42.0.0/16` (k3s pod CIDR) with a comment.
- **ci.yml:** on PR and push, run `npm ci`, lint, typecheck, test and build on Node 26. Add `npm audit --audit-level=high` and the CodeQL init/analyze steps for JavaScript/TypeScript.
- **docker.yml:**
  - Triggers: push to `main` and tags `v*`.
  - Permissions: `contents: read`, `packages: write`, `id-token: write`, `attestations: write`.
  - Steps:
    1. `docker/setup-qemu-action` and `docker/setup-buildx-action`.
    2. `docker/login-action` to ghcr.io with `GITHUB_TOKEN`.
    3. `docker/metadata-action`, producing tags `latest` (on main), `sha-<short>` and semver.
    4. `docker/build-push-action` with `platforms: linux/amd64,linux/arm64`, `provenance: mode=max`, `sbom: true` and GHA cache.
    5. `actions/attest-build-provenance`.
  - Pin every action by full commit SHA with a `# vX` comment. Resolve SHAs with `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`.
- **dependabot.yml:** weekly updates for the npm, docker and github-actions ecosystems.
- **README.md (Dutch):**
  - What the app is: one paragraph and screenshots, or links to `docs/design/mockups/`.
  - The env table, copied from `.env.example`.
  - Running locally: `npm run dev` + `npm run dev:server`.
  - Docker run.
  - k3s deploy: `kubectl create secret generic …`, plus the logo ConfigMap via `kubectl create configmap werkplekinspectie-branding --from-file=logo.svg`.
  - Cloudflare Tunnel notes, including the `TRUST_PROXY` explanation.
  - Advice: one Cloudflare rate-limit rule on `/api/`.
  - Resend setup: verify the domain and use `smtp.resend.com:465`, user `resend`, the API key as password.
  - Privacy: what is stored where.
  - A statement that the repo contains no company branding.
- `test/build/server-start.test.ts`: spawn `node dist/server/server/index.js` with an env that has a fake SMTP host and `PUBLIC_ORIGIN=http://localhost`, with `NODE_ENV=test`. Wait for `/healthz` to return 200. GET `/` returns HTML containing `Werkplekinspectie`. Then kill the process.

- [ ] **Step 1:** Write `server-start.test.ts`. Run `npm run build && npx vitest run test/build/server-start.test.ts` and expect FAIL until `index.ts` and the static path line up.
- [ ] **Step 2:** Fix the paths and get it passing.
- [ ] **Step 3:** Write the Dockerfile, the k8s manifests, the workflows, dependabot and the README. Validate the YAML with `npx yaml-lint` or `python3 -c "import yaml…"`. `docker` is not available locally, so CI is the image test.
- [ ] **Step 4:** Run `npm run lint && npm run typecheck && npm test && npm run build`. All must pass.
- [ ] **Step 5:** Commit: `build: dockerfile, k8s manifests, ci, readme`.

### Task 16: Publish to GitHub and verify CI

**Files:** none new.

- [ ] **Step 1:** Run the local, untracked branding grep (terms kept outside the repo) over the whole tree. Expect no hits.
- [ ] **Step 2:** Run `gh repo create SilkePilon/werkplekinspectie --public --source . --remote origin --description "PWA voor werkplekinspecties (Arbo en Milieu) met PDF per mail" --push`.
- [ ] **Step 3:** Watch the runs with `gh run list --limit 5`. When finished, `gh run view <id>` must show both `ci` and `docker` succeeded. Fix and push if not.
- [ ] **Step 4:** Run `gh api /users/SilkePilon/packages/container/werkplekinspectie/versions --jq '.[0].metadata.container.tags'`. It must include `latest`. Make the package public if the user wants anonymous pulls; ask first, because it is outward-facing.
- [ ] **Step 5:** Report the image reference `ghcr.io/silkepilon/werkplekinspectie:latest` and the deploy steps from the README.
