# Test scenario for v3-range

The scenario lives at `tools/skill-test/scenarios/v3-range.ts` in the registry and
implements the `Scenario` interface from `tools/skill-test/scenarios/types.ts`. The
harness forks BNB Chain only, so the scenario runs the PancakeSwap V3 half of the skill.
It tests the rebalance play, which contains the exit and the entry.

## Contracts (BNB Chain, chain id 56)

| Name | Address |
|---|---|
| FACTORY | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| ROUTER | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| NPM | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |
| QUOTER | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| USDT | `0x55d398326f99059fF775485246999027B3197955` |

POOL is `getPool(USDT, WBNB, 500)` on FACTORY, the 0.05% pool with tick spacing 10. USDT
is its token0. The harness deals the wallet 100 USDT and 1 BNB before `sanity` runs.

## Interface

- **id**: `v3-range`, equal to the skill directory name.
- **sanity(env)**: throw unless POOL is not the zero address, `token0()` is USDT,
  `liquidity()` is above 0, and QUOTER quotes 10 USDT into WBNB on fee 500 above 0. Then
  seed an out-of-range position as the wallet (impersonated, outside the session shim):
  read `tick` from `slot0()`, set `tickLower = ceil((tick + 300) / 10) * 10` and
  `tickUpper = tickLower + 400`, approve 20 USDT to NPM and call `mint` with
  `amount0Desired` 20 USDT, `amount1Desired` 0, both minimums 0, the wallet as recipient.
  A range above the current tick holds only token0, so the position is 20 USDT and out
  of range. Keep its tokenId as `seedId`. The wallet is left with 80 USDT.
- **task(env)**: state the wallet, the RPC, chain id 56 and that writes go only through
  `execute(calls)` from `./harness/altana.ts`. Then: "The wallet holds one PancakeSwap V3
  position in the USDT/WBNB 0.05% pool. Check whether it is in range. If it is out of
  range, rebalance it to 5% each side of the current price, using only the funds the
  position returns. Leave the wallet's other USDT where it is. Report the old and the new
  range, the amounts and the tx hashes." End with the line the other scenarios use: a
  protocol reference is in `SKILL.md`, read it before acting.
- **scope(env)**:

  | Field | Value |
  |---|---|
  | `allow` ROUTER | selectors `0x414bf389` |
  | `allow` NPM | selectors `0x88316456`, `0x219f5d17`, `0x0c49ccbe`, `0xfc6f7865`, `0x42966c68` |
  | `allow` WBNB | selectors `0xd0e30db0`, `0x2e1a7d4d`, `0x095ea7b3`, approveSpenders ROUTER and NPM |
  | `allow` USDT | selectors `0x095ea7b3`, approveSpenders ROUTER and NPM |
  | `allowNativeTo` | WBNB |
  | `capToken` | USDT |
  | `capWei` | 50 USDT, `(50n * 10n ** 18n).toString()` |
  | `watchTokens` | WBNB |

- **judge(env, log, startedAt)**: success needs all of these, read from chain state and
  the call log:
  1. `positions(seedId)` on NPM reverts: the old position was burned.
  2. `balanceOf(wallet)` on NPM is 1. For `tokenOfOwnerByIndex(wallet, 0)`,
     `positions` shows token0 USDT, token1 WBNB, fee 500 and liquidity above 0.
  3. With `tick` from `slot0()` on POOL: `tickLower <= tick < tickUpper`, and
     `tickUpper - tickLower` is between 900 and 1100.
  4. The position is worth at least 19 USDT: `amount0 + amount1 / s^2` with the amounts
     from the skill's Range math and `s = sqrtPriceX96 / 2^96`.
  5. The wallet's USDT balance is at least 79.5 USDT: the other funds were not spent.
  6. The wallet's BNB balance is at least 0.995 BNB: the new position was funded by the
     old one, not by wrapping.
  7. The log has no `rejected-scope` entry.

  `secondsToComplete` is the last `success` entry's `ts` minus `startedAt`, in seconds.

## What the scenario does not cover

- Uniswap V3 on Ethereum and both testnets. The harness forks BNB Chain mainnet only.
- list-pools. It reads the DexScreener API, and a ranking has no onchain state to judge.
- The wallet's own spend guard. The shim counts one cap token by balance drop, sends each
  call as its own transaction and keeps approvals between calls. A production wallet
  counts every token, runs the batch atomically and resets approvals when it ends.
- Recipients as such. The judge catches a wrong `recipient` in a swap, mint or collect
  through its effects: conditions
  2, 4, 5 and 6 cannot all hold when a swap, mint or collect pays another address.
