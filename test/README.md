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
pnpm test
pnpm run test:unit
pnpm run db:test
pnpm run test:e2e
pnpm run test:e2e --project=integration
pnpm run test:e2e --project=browser
```

`test:unit` is the fast unit suite and does not require Supabase. `db:test`
expects the local Supabase stack and current migrations to be ready. Start and
stop the stack explicitly with `pnpm run db:start` and `pnpm run db:stop`; test
commands do not manage its lifecycle.

`test:e2e` resets Supabase, runs pgTAP, and invokes Playwright once. Playwright's
`webServer` builds the application, starts `next start` on port 3010, and stops
it when the run finishes. Pass `--project=integration` or `--project=browser`
to run one Playwright project through the same lifecycle.

`pnpm test` uses pnpm's regular-expression runner to execute `test:unit` and
`test:e2e` together. Only those two parallel-safe top-level scripts use the
`test:` namespace; database and Playwright project selection stay inside the
single `test:e2e` process.

Local E2E commands reset and write to the same Supabase stack. Do not run them
concurrently, and do not use a local database that contains data you need to
preserve.

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
