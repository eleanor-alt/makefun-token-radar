# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/eleanor-alt/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/eleanor-alt/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over one sealed DefiLlama snapshot: every pre-token protocol on the watchlist
(all 40, $50M+ TVL, no token on record) plus 160 early finds below the floor, ranked by implied value.
The model (radar-2) does not use a flat TVL multiple: it prices each protocol with the market's own
pricing of its category — the median market-cap/TVL of the snapshot's tokenised protocols in that
category, shrunk toward the global median by sample size — then adjusts for seven-day TVL growth and
for how long the protocol has run with no token. Every row's detail view shows its exact peer multiple
and a concrete farm plan with costs and times, and the page recomputes each row live so the board and
the dashboard can never drift apart. The 24 biggest live-token protocols are set aside with their real
market caps, never mixed into the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=s3225a1s&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
