# Replayable Rooms Validation

## Validation Target

Verify every requirement in `requirements.md` against the destructive Game
separation implementation, including concurrency, secrecy, stale mutation
rejection, UI settlement, and repeat play.

## Executed Checks

| Check                                            | Result                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm run fix`                                   | Passed                                                                      |
| rumdl over 18 changed Markdown files             | Passed with no issues                                                       |
| `pnpm run lint`                                  | Passed                                                                      |
| `pnpm exec tsgo --noEmit`                        | Passed                                                                      |
| `pnpm run test:unit`                             | Passed: 43 files, 361 tests                                                 |
| `pnpm run db:reset`                              | Passed from the four-migration clean baseline                               |
| `pnpm run db:test`                               | Passed: 4 files, 143 tests                                                  |
| `pnpm run lint:db`                               | Passed with no schema errors                                                |
| `pnpm run db:diff`                               | Passed with no schema changes                                               |
| `pnpm run build` with required trusted-IP header | Passed production build                                                     |
| `pnpm run test:e2e`                              | Passed: clean DB reset, DB suite, production build, and 55 Playwright tests |
| `git diff --check`                               | Passed                                                                      |

Structural searches found legacy one-Game tables, RPCs, and waiting-expiry names
only in intentional absence assertions and design history. Game artifacts use
`game_id`; the retained Room IDs belong to Room lifecycle, membership,
same-Room foreign keys, and authorization boundaries.

After extracting the shared integer request validator, Indexion found no similar
production file groups in `app` or `lib`. Its one remaining same-file function
similarity is in the toast state machine and represents distinct dismiss and
exit-completion transitions. The unwrap audit found no wrappers in `app` or
`lib`.

## Requirement Coverage

| Requirements                                                     | Evidence                                                                                                     | Result |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| `REPLAY-ROOM-*`, `REPLAY-GAME-*`, `REPLAY-RESULT-*`              | schema-security and Game transaction pgTAP; Room view unit tests; replay lifecycle integration               | Passed |
| `REPLAY-JOIN-*`, `REPLAY-READY-*`, `REPLAY-START-*`              | Room lifecycle and Game transaction pgTAP; membership and replay integration; live presentation unit tests   | Passed |
| `REPLAY-STALE-001`, `REPLAY-REALTIME-001`, `REPLAY-REVISION-001` | Game transaction and realtime pgTAP; mutation route, realtime grant, repository, and Game-session unit tests | Passed |
| `REPLAY-UI-*`                                                    | Game-bound effect model tests and replay browser tests                                                       | Passed |
| Security and expiry acceptance criteria                          | schema-security, authorization, Room lifecycle, action privacy, and replay suites                            | Passed |

No separate manual confirmation was required. The 55 Playwright tests exercised
the user flows against the production build, including same-roster replay and a
new participant clearing the completed Game.

## Residual Issues

None.
