# Redeem resolved Polymarket positions through KeeperHub

A resolved prediction market is a settled decision that nobody has executed
yet. The oracle has spoken, the payout is fixed, and the money still sits in
the Conditional Tokens contract until someone sends a transaction. This project
makes [KeeperHub](https://docs.keeperhub.com/) the thing that sends it, for
[Polymarket](https://polymarket.com) markets on Polygon.

An agent authors the workflow. A human reads it and its hash. It is dry-run
against live chain state without touching the chain. Then that exact workflow,
unchanged, executes. Nothing is inferred at execution time: every argument in
the redeem call is a literal in the file you reviewed.

## What it does

```
Schedule  ->  read payoutDenominator(conditionId)  ->  is it > 0?  --true-->  redeemPositions(conditionId)
  CTF                    CTF                          Condition              CtfCollateralAdapter -> pUSD
```

`payoutDenominator` is the CTF's own settlement flag: zero until the oracle
reports payouts, non-zero forever after. When it flips, the workflow calls
`redeemPositions` on the collateral adapter for the market's type, which burns
the outcome tokens and pays the winning side out in pUSD to the wallet that
held them.

## Why this is worth automating

Redeeming is the one step of the Polymarket lifecycle with no deadline and no
counterparty, which is exactly why it gets forgotten. Polymarket auto-redeems
for wallets it operates; a position held by anyone else, an agent's treasury,
a Safe, a market maker's own wallet, stays unredeemed until a human remembers.
This turns that into a workflow that was reviewed once and then fires on its
own, with a run record for every attempt.

## The two swappable parts

Changing the live project means replacing two modules and nothing else:

| Part | Interface | Current implementation |
|---|---|---|
| The resolution event | [`src/resolution/types.ts`](src/resolution/types.ts) | [`ctf-payout-poll.ts`](src/resolution/ctf-payout-poll.ts), with [`ctf-resolution-event.ts`](src/resolution/ctf-resolution-event.ts) as the event-driven alternative |
| The call that moves value | [`src/payout/types.ts`](src/payout/types.ts) | [`polymarket-redeem.ts`](src/payout/polymarket-redeem.ts) |

[`compose.ts`](src/workflow/compose.ts) is the only file that knows both exist.

## Usage

```bash
npm install
cp .env.example .env        # add a kh_ organization key from app.keeperhub.com

npm run cli verify                               # check every address against Polygon
npm run cli plan -- --slug <market-slug>         # author the workflow, write it to workflows/
npm run cli preflight -- --plan workflows/<f>    # read the chain for what the plan depends on
npm run cli deploy -- --plan workflows/<f>       # create it on KeeperHub, disabled
npm run cli dry-run -- --plan workflows/<f>      # simulate, nothing is broadcast
npm run cli arm -- --plan workflows/<f>          # enable the trigger
```

`deploy` refuses to create a workflow whose hash differs from the reviewed
plan, and `dry-run` re-reads the deployed workflow and compares it against the
same hash. That is what makes "the exact reviewed workflow executes" a check
rather than a claim.

To make a position to redeem in a demo, `setup-approval` approves the adapter
and `setup-split` splits a tiny amount of pUSD into one YES and one NO token.
Both run as KeeperHub workflows, so every transaction this project makes lands
in the same audit trail. `setup-split` refuses amounts above 5 pUSD.

## Verified, not remembered

Every contract address and function signature was checked against live Polygon
state before being used, including one plausible-looking address from an
official Polymarket README that is no longer the live deployment. The evidence,
and the KeeperHub behaviour that shaped the design, is in
[docs/verification.md](docs/verification.md).

## Known limits

- The default trigger polls, because KeeperHub's Event trigger cannot filter on
  event arguments and Polymarket resolves roughly 700 markets an hour. The
  event-driven variant is implemented and carries that cost warning.
- One workflow watches one market. Watching a portfolio means one workflow per
  position.
- Dry run is advisory. It proves the call does not revert against current
  state, at the sender the simulator chose.
