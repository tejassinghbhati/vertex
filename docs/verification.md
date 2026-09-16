# Verified facts

Every address and signature this project uses was checked against live Polygon
state, not taken from memory or from a single docs page. `npm run cli verify`
re-runs the contract half of this on demand.

Checked on 2026-09-15 against Polygon mainnet (chain id 137).

## Addresses

| Contract | Address | How it was checked |
|---|---|---|
| Conditional Tokens (CTF) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` | 15,007 bytes of code; named as `CONDITIONAL_TOKENS()` by both adapters |
| pUSD (collateral) | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` | named as `COLLATERAL_TOKEN()` by both adapters |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | returned by `USDCE()` on both adapters |
| CtfCollateralAdapter | `0xAdA100Db00Ca00073811820692005400218FcE1f` | 7,166 `PayoutRedemption` events in a 4,000-block window; `paused(USDC.e) = false` |
| NegRiskCtfCollateralAdapter | `0xadA2005600Dec949baf300f4C6120000bDB6eAab` | `paused(USDC.e) = false`; named as the current adapter in the Jul 14 2026 changelog |

### A stale address that looks authoritative

The `Polymarket/ctf-exchange-v2` README lists different adapters:
`0xADa100874d00e3331D00F2007a9c336a65009718` and
`0xAdA200001000ef00D07553cEE7006808F895c6F1`. Both are real contracts, so
bytecode presence alone does not tell them apart. Live redemption counts do: in
the same 4,000-block window the docs address served 7,166 redemptions and the
README address 188. The README was last touched in April 2026. This project
uses the docs addresses, and `cli verify` asserts their wiring rather than
their existence.

## Signatures

| Signature | How it was checked |
|---|---|
| `redeemPositions(address,bytes32,bytes32,uint256[])` | selector present in both adapters' deployed bytecode; matches `CtfCollateralAdapter.sol` |
| `splitPosition(address,bytes32,bytes32,uint256[],uint256)` | same source, same adapter |
| `payoutDenominator(bytes32)`, `getCollectionId(bytes32,bytes32,uint256)`, `getPositionId(address,bytes32)`, `balanceOfBatch(address[],uint256[])` | selectors present in the deployed CTF bytecode |
| `ConditionResolution(bytes32,address,bytes32,uint256,uint256[])` | topic `0xb44d84d3…5894` matched 1,573 live logs from the CTF in a 4,000-block window |
| `PayoutRedemption(address,address,bytes32,bytes32,uint256[],uint256)` | topic `0x2682012a…d18d` matched 41,407 live logs over the same window |

## Behaviour the design depends on

**Redeeming twice is safe.** `ConditionalTokens.redeemPositions` skips any
outcome where the caller's balance is zero and only transfers when the total
payout is above zero, and `CollateralToken.wrap` has no zero-amount guard. A
second run after a successful redemption moves nothing instead of reverting,
so a trigger that fires more than once cannot double-spend.

**The adapter ignores three of its four arguments.** `collateralToken`,
`parentCollectionId` and `indexSets` are kept for `IConditionalTokens`
compatibility. The adapter always redeems the caller's full balance for both
outcomes of the condition. The workflow still passes the documented values.

**Positions are collateralized in USDC.e, paid out in pUSD.** The adapter
burns the ERC-1155 outcome tokens through the legacy CTF, receives USDC.e, and
wraps it into pUSD for the caller. Position ids therefore derive from the
USDC.e address, which is why `preflight` computes them with `USDCE()`.

**Redemption has no deadline.** Winning tokens stay redeemable indefinitely, so
a polling trigger that lags behind resolution costs time and nothing else.

**Not every market waits two hours for UMA.** The docs describe the UMA
optimistic oracle path, roughly two hours from proposal when undisputed. The
short "Up or Down" crypto markets do not use it: six markets ending
2026-09-16T11:10:00Z were all resolved on chain at 11:10:54Z, a lag of 0.9
minutes, reported by oracle `0x58e1745bEDdA7312c4CddB72618923dA1B90eFde`
rather than a UMA CTF adapter. `ConditionResolution` from the CTF is the same
signal either way, which is why the resolution source watches the CTF and not
any particular oracle. It also makes a live end-to-end demo take minutes
instead of hours.

In a 4,000-block sample the resolving oracles were
`0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7` (871 events), the CLOB v1 neg-risk
adapter `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` (472) and
`0x58e1745bEDdA7312c4CddB72618923dA1B90eFde` (224).

## KeeperHub behaviour that shaped the build

**The Event trigger cannot filter on event arguments.** `workflow-mapper.ts` in
`keeperhub-events/event-tracker` reads `network`, `contractAddress`,
`contractABI` and `eventName`; the only post-decode filters are the Transfer
trigger's `recipientAddress` and `memo`. Polymarket resolves roughly 700
markets an hour, and each one would wake the workflow and bill an execution.
That is why the default resolution source polls `payoutDenominator` instead.
The event variant is implemented and documented for when filtering lands.

**`stateThreshold` would be the right trigger and is not available yet.**
KeeperHub issue #2240 describes exactly this case, an `eth_call` threshold
evaluated once per block. PR #2332 merged the core evaluation logic on
2026-09-11, but the trigger is absent from the public `TRIGGERS` schema, the
API's accepted `triggerType` values and the builder UI.

**Workflow dry run is advisory and skips templated fields.**
`POST /api/workflows/{id}/simulate` simulates `web3/write-contract` nodes and
returns warnings only, and `run-simulation.ts` skips any node whose
`network`, `contractAddress`, `abi`, `abiFunction`, `functionArgs` or
`ethValue` contains a `{{...}}` template. Keeping every redeem argument
literal is what makes the dry run cover the call that actually executes.

**A softened write failure reports success with no transaction hash.** With
`failOnError: false` a failed write returns `success: true` and the run settles
as `success` with an empty `transactionHashes`. Every write node here sets
`failOnError: true`, so the audit trail cannot claim a redemption that never
happened.
