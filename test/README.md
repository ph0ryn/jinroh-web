# Test strategy

Jinroh Web tests are split by the boundary they exercise. Put each behavior in
the lowest layer that can prove it.

## Layers

- Co-located `app/**/*.test.ts` and `lib/**/*.test.ts` files cover pure UI
  models, game rules, projections, and server helpers with Vitest.
- `test/tooling/**/*.test.ts` covers the local test runner itself.
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

`test:unit` is the fast default and does not require Supabase. `test:db`
expects the local Supabase stack and current migrations to be ready.

`test:integration` and `test:browser` each own a destructive local lifecycle:
they acquire a machine-local lock, reset the loopback-only Supabase project,
wait for Realtime, build once, start `next start`, run the selected Playwright
project, and release the server port. Do not run those commands concurrently.
Override the application port with `E2E_PORT` when another service uses 3010.

`test:all` runs Vitest, resets Supabase once, runs pgTAP, builds once, and then
runs both Playwright projects against the same managed server.

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
