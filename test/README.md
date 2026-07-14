# Test strategy

Jinroh Web tests are split by the boundary they exercise. Put each behavior in
the lowest layer that can prove it.

## Layers

- Co-located `app/**/*.test.ts` and `lib/**/*.test.ts` files cover pure UI
  models, game rules, projections, and server helpers with Vitest.
- `test/integration/**/*.spec.ts` covers HTTP, persistence, authorization, and
  Realtime contracts through a running application server.
- `test/browser/**/*.spec.ts` covers a small set of user journeys, responsive
  behavior, accessibility, and final animation settlement in Chromium.
- `supabase/tests/*.sql` covers database constraints, transactions, privileges,
  and RLS with pgTAP.

Shared Playwright fixtures belong in `test/fixtures/`. Keep room creation,
identity setup, API access, locale setup, and stable page locators there instead
of duplicating them across specs.

## Commands

```sh
pnpm run test:unit
pnpm run test:db
pnpm run test:integration
pnpm run test:browser
pnpm run test:all
```

`test:unit` is the fast default and does not require Supabase. `test:db` starts
Supabase when needed, resets the local database, and then runs pgTAP.

`test:integration` and `test:browser` run the corresponding Playwright project.
For local runs, the shared package lifecycle first checks `supabase status` and
runs `supabase start` when the stack is unavailable. Playwright's `webServer`
then reads the local credentials, rejects a non-loopback Supabase API URL,
resets Supabase, builds the application, and starts `next start`. Playwright
stops the application after every run. The package lifecycle also runs
`supabase stop` when it started the stack, including after a failure or signal,
while preserving a stack that was already running. Override the application
port with `E2E_PORT` when another service uses 3010.

`supabase start` uses the currently configured Docker-compatible runtime; the
test lifecycle does not call an OrbStack-specific command.

`test:all` runs Vitest and then invokes Playwright once for both projects. Its
shared local lifecycle starts Supabase when needed; Playwright then resets it,
runs pgTAP, builds once, and starts one application server for the run.

Local Playwright commands reset and write to the same Supabase stack. Do not run
them concurrently, and do not use a local database that contains data you need
to preserve.

## Remote previews

The Playwright suites create identities and rooms. They refuse every remote
base URL unless destructive writes are explicitly authorized:

```sh
E2E_BASE_URL=https://isolated-preview.example \
E2E_ALLOW_REMOTE_WRITES=1 \
pnpm run test:browser
```

Use only an isolated disposable preview. Never point these suites at production.
Remote runs do not reset a database, build the application, or start a server.

## Assertion boundaries

- Assert stable state, permissions, error codes, and user-visible outcomes.
- Use stable fixture locators for ordinary interaction. Do not duplicate display
  copy in feature tests.
- Keep exact copy coverage in localization tests. Accessibility tests may assert
  that a control has a non-empty accessible name without freezing its wording.
- Test animation decisions in pure models. Browser tests should verify final
  state, interaction, reduced-motion behavior, and cleanup rather than transient
  GSAP styles or diagnostic markers.
- Do not import a production constant merely to compare the UI with the same
  constant; that only proves both sides share an implementation.
