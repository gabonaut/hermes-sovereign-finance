---
name: v3-range
description: Provide V3 liquidity on PancakeSwap (BNB) and Uniswap (ETH).
version: 1.0.0
author: Sovereign Finance
license: GPL-3.0
metadata:
  hermes:
    tags: [defi, liquidity, pancakeswap, uniswap, bnb-chain, ethereum]
---

# V3 Range

Provide concentrated liquidity on PancakeSwap V3 (BNB Chain) and Uniswap V3 (Ethereum)
from an Altana wallet and keep it in range: rank pools, size a range, enter, check it,
rebalance when the price leaves it, collect fees. Submit onchain writes only through your
Altana session executor (`execute(calls)` with the SDK, or the `session_execute` MCP
tool). Reads go directly against the RPC. In Hermes, the plugin section near the end maps
each play to its tools.

## When to use

Use this skill when the user wants to earn swap fees from a price range on PancakeSwap V3
or Uniswap V3, asks which pools pay most, asks whether a position is still in range, or
when a scheduled range check runs. It does not cover V2 pools, Uniswap V4, farms that
stake positions, or any other chain.

## Reference

PancakeSwap V3 is a fork of Uniswap V3 and shares its position manager, quoter and pool
math. A position is an NFT in the wallet that holds liquidity between two ticks. It earns
swap fees only while the pool's current tick is inside them, and outside them it sits
entirely in one of the two tokens.

### Addresses (BNB Chain and BNB testnet)

| Contract | BNB Chain (56) | BNB testnet (97) |
|---|---|---|
| PancakeSwap V3 Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| PancakeSwap V3 SwapRouter | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| PancakeSwap V3 NonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `0x427bF5b37357632377eCbEC9de3626C71A5396c1` |
| PancakeSwap V3 QuoterV2 | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` | `0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` |
| USDT (18 decimals) | `0x55d398326f99059fF775485246999027B3197955` | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` |
| USDC (18 decimals) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | not used |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | not used |
| ETH (Binance-Peg) | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` | not used |
| BUSD | not used | `0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee` |

### Addresses (Ethereum and Sepolia)

| Contract | Ethereum (1) | Sepolia (11155111) |
|---|---|---|
| Uniswap V3 Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| Uniswap SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| Uniswap V3 NonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `0x1238536071E1c677A632429e3655c799b22cDA52` |
| Uniswap V3 QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC (6 decimals) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| USDT (6 decimals) | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | not used |
| WBTC (8 decimals) | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | not used |

Every token in the BNB Chain and BNB testnet columns has 18 decimals, and so does WETH.
Read `decimals()` onchain anyway: USDT and USDC have 18 on BNB Chain and 6 on Ethereum.

Pools are not in the tables. `getPool(tokenA, tokenB, fee)` on the factory returns the
pool, or the zero address when there is none. `token0` is the token with the lower
address. Pools, the factory and QuoterV2 are only read.

### Session scope

The session is scoped to these calls:

| Target | Functions |
|---|---|
| Router | `exactInputSingle` |
| Position manager | `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, `burn` |
| Wrapped native token (WBNB or WETH) | `deposit`, `withdraw`, `approve` |
| Each pool token the user permits | `approve` |

The wallet refuses everything else onchain with `UnauthorizedCall`: token `transfer`,
transfers and approvals of the position NFT, `multicall`, staking in a farm, any other
contract. Native value goes only to the wrapped token's `deposit()`, never to the router
or the position manager.

### How the wallet counts spend

- Every token a batch moves needs its own daily cap, the native coin included. A token
  without one reverts the batch with `NoSpendPermissions`. A cap that is used up reverts
  it with `ExceededSpendLimit`.
- Per token the wallet counts the larger of two numbers: the face value of the batch's
  `approve` and `transfer` calls, and the drop in balance. A token bought and minted in
  the same batch still counts at the face value of its approval.
- The wallet resets every approval to zero when the batch ends.
- Wrapping counts as native spend. The relay fee is paid in the native coin and counts
  against the native cap. A batch whose maximum fee does not fit is rejected before it is
  sent, with relay code 300.
- A mint batch approves the full holdings of the token it sells (swap input plus mint
  amount) and the mint amount of the token it buys, about half the position's value.
- Caps that last a day: native cap at least (amount wrapped plus maximum fee) per batch
  times batches per day, each token cap at least that token's approvals per batch times
  batches per day. A rebalance is two batches, and only the second one approves.

### What differs between the two DEXs

| | PancakeSwap V3 | Uniswap V3 |
|---|---|---|
| `exactInputSingle` struct | `deadline` after `recipient` | no `deadline` |
| `exactInputSingle` selector | `0x414bf389` | `0x04e45aaf` |
| `feeProtocol` in `slot0()` | `uint32` | `uint8` |
| Fee tier / tick spacing | 100/1, 500/10, 2500/50, 10000/200 | 100/1, 500/10, 3000/60, 10000/200 |
| Protocol's share of a swap fee | `feeProtocol % 65536` / 10000 (token0 sold), `feeProtocol >> 16` / 10000 (token1 sold) | 1/n with n = `feeProtocol % 16` (token0 sold) or `feeProtocol >> 4` (token1 sold), 0 for none |

The wrong swap struct fails. PancakeSwap's `feeProtocol` does not fit `uint8`, so its
`slot0()` cannot be decoded with Uniswap's ABI. The fee unit is a hundredth of a basis
point: 500 is 0.05%.

### Quirks that cause mistakes

- Ticks are often negative, in USDT/WBNB on BNB Chain for one. Round toward negative
  infinity, not toward zero.
- `mint` reverts without a message when the tokens are not in `token0`, `token1` order or
  a tick is not a multiple of the spacing.
- `tokensOwed0` and `tokensOwed1` in `positions()` leave out the fees earned since the
  position was last touched. A static `collect` call returns the real amounts.
- QuoterV2 is not a view function. Call it with `eth_call`. In its struct `amountIn` comes
  before `fee`.
- `burn` needs liquidity 0 and nothing owed, so the order is `decreaseLiquidity`,
  `collect`, `burn`. `decreaseLiquidity` reverts when asked for liquidity 0.
- USDT on Ethereum rejects `approve` while a non-zero allowance for that spender remains,
  and a `mint` can pull less than it was approved. Approve each spender once per batch.
- Testnet pool prices do not follow the market. Size every amount from the pool's own
  price.

### Functions

- PancakeSwap SwapRouter: `exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))`
- Uniswap SwapRouter02: `exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))`
- Position manager, both DEXs:
  - `mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline))` `0x88316456`
  - `increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline))` `0x219f5d17`
  - `decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline))` `0x0c49ccbe`
  - `collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max))` `0xfc6f7865`
  - `burn(uint256 tokenId)` `0x42966c68`
  - `positions(uint256 tokenId)` returns `(uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)`
  - `balanceOf(address owner)`, `tokenOfOwnerByIndex(address owner,uint256 index)`
- QuoterV2, both DEXs: `quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96))` returns `(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)`
- Pool: `slot0()` returns `(uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint32 or uint8 feeProtocol,bool unlocked)`, plus `fee()`, `tickSpacing()`, `liquidity()`, `token0()`, `token1()`
- Factory: `getPool(address tokenA,address tokenB,uint24 fee)`
- Wrapped native token: `deposit()` payable `0xd0e30db0`, `withdraw(uint256 amount)` `0x2e1a7d4d`
- Any token: `approve(address spender,uint256 amount)` `0x095ea7b3`, `decimals()`, `balanceOf(address owner)`

`deadline` is unix seconds, now + 600. `sqrtPriceLimitX96` is 0. `amount0Max` and
`amount1Max` are `2^128 - 1`, which collects everything owed.

### Range math

Amounts are in the tokens' smallest units.

```text
s  = sqrtPriceX96 / 2^96
sa = 1.0001^(tickLower / 2)
sb = 1.0001^(tickUpper / 2)
c  = min(max(s, sa), sb)
amount0(L, s) = L * (sb - c) / (c * sb)
amount1(L, s) = L * (c - sa)
```

- A position is in range when `tickLower <= tick < tickUpper`. Below the range it is all
  token0, above it all token1. The clamp `c` covers both cases.
- Price of token0 in token1, in whole tokens: `1.0001^tick * 10^(decimals0 - decimals1)`.
  Invert it to quote token1 in token0. The lower tick then gives the upper price.
- Width of p percent each side: `d = ln(1 + p/100) / ln(1.0001)` ticks, about 100 per 1%.
  `tickLower = floor((tick - d) / spacing) * spacing` and
  `tickUpper = ceil((tick + d) / spacing) * spacing`, both within -887272 and 887272.
  Check: tick -65139, spacing 10 and p = 2 give d = 198.04 and the range -65340 to -64940.
- Liquidity a mint or increase creates from the amounts `d0`, `d1`, in range:
  `L = min(d0 * s * sb / (sb - s), d1 / (s - sa))`.
- Share of an in-range position's value held in token0: `w0 = v0 / (v0 + v1)` with
  `v0 = s * (sb - s) / sb` and `v1 = s - sa`.
- Swap that brings the holdings `x0`, `x1` to that share, with `p = s^2` and
  `f = fee / 1000000`: `e = x0 * (1 - w0) - w0 * x1 / p`. If `e > 0`, swap
  `e / (1 - f * w0)` of token0 into token1. Otherwise swap
  `-e * p / (1 - f * (1 - w0))` of token1 into token0.
- Minimums for `mint`, `increaseLiquidity` and `decreaseLiquidity`, with `L` the liquidity
  the call adds or removes: `amount0Min = amount0(L, s * sqrt(1 + slippage))` and
  `amount1Min = amount1(L, s * sqrt(1 - slippage))`. Take 0.01% off each and round down,
  so float rounding never lifts a minimum above what the pool pays. The side an
  out-of-range position does not hold comes out as 0.
- Double precision is enough. The position manager recomputes liquidity and amounts
  onchain, and these numbers only cap what it may pull and floor what it must pay.

## Playbook

### Play: list-pools

Rank the network's V3 pools on the listed tokens by 24 h volume, with fee tier, TVL and
fee APR, and let the user choose. Parameters: network, number of rows (default 10).

**Typical time:** reads only

1. For each token in the network's address table, request
   `https://api.dexscreener.com/token-pairs/v1/{chain}/{tokenAddress}` with chain `bsc` or
   `ethereum`. One answer lists at most 30 pairs, hence one request per token.
2. Keep the pairs whose `dexId` is `pancakeswap` on `bsc` or `uniswap` on `ethereum` and
   whose `labels` contain `v3`. Both tests matter: each DEX also runs on the other chain,
   and Uniswap V4 pairs carry the same `dexId`. Merge by `pairAddress`.
3. The fee tier is not in the API. Read `fee()`, `token0()` and `token1()` on each pool,
   and keep the pool only if `getPool(token0, token1, fee)` on the factory returns its
   address.
4. fee APR = `volume.h24 * (fee / 1000000) / liquidity.usd * 365`. This is the pool's
   gross rate over the last 24 h. Both DEXs keep the protocol's share of each fee: 32 to
   34% on the PancakeSwap pools and 1/6 or 1/4 on the Uniswap pools read on 2026-11-10.
5. Sort by `volume.h24`, highest first. Show pair, pool address, fee tier, 24 h volume,
   TVL (`liquidity.usd`), fee APR, and whether both tokens are in the session scope. Do
   not filter by incentives, TVL, APR or anything else. The user chooses. A pool with a
   token outside the scope waits until the user grants a session that covers it.
6. On testnets DexScreener has no data. Call `getPool` for each pair of table tokens and
   each fee tier and list the pools that exist with `liquidity()` above 0. Volume, TVL
   and fee APR are not available there.

### Play: size-range

Turn a width into ticks for one pool and show the user what the range means. Parameters:
network, pool, width in percent each side of the current price (or explicit ticks).

**Typical time:** reads only

1. Read `slot0()`, `tickSpacing()`, `fee()`, `token0()` and `token1()` on the pool and
   `decimals()` on both tokens.
2. Compute `tickLower` and `tickUpper` (Range math). Explicit ticks must be multiples of
   the spacing with `tickLower <= tick < tickUpper`.
3. Report the ticks, the lower, current and upper price in the unit the user quotes the
   pair in, and the token split at entry (`w0`). A narrower range earns more while in
   range and leaves it sooner, and every rebalance costs a swap fee, price impact and two
   relay fees.

### Play: enter

Open a position in one batch: wrap native if needed, swap to the range's ratio, mint.
Parameters: network, pool, budget (token or native coin, and amount), range (width or
ticks), slippage (default 0.5%).

**Typical time:** one batch

1. Run size-range. Read the wallet's balances of both tokens and of the native coin. Set
   `x0` and `x1` to the amounts to deploy. A native budget counts as the wrapped token.
2. Compute the swap (Range math) and skip it when the amount rounds to 0. Quote it with
   QuoterV2 on every fee tier that has a pool for the pair and take the best `amountOut`.
   Set `amountOutMinimum = amountOut * (1 - slippage)`. If the swap runs through the pool
   being entered, use `sqrtPriceX96After` as `s` from here on.
3. Mint amounts: for the token sold, `x` minus the swap input. For the token bought, `x`
   plus `amountOutMinimum`. Compute `L` and both minimums (Range math).
4. `execute([deposit() with the native value (only when wrapping), approve(tokenIn, router, amountIn), exactInputSingle(...), approve(token0, positionManager, amount0Desired), approve(token1, positionManager, amount1Desired), mint(...)])`.
   Every `recipient` is the wallet.
5. Verify: `balanceOf(wallet)` on the position manager rose by one,
   `tokenOfOwnerByIndex(wallet, balance - 1)` is the new tokenId, and `positions(tokenId)`
   shows the pool's tokens and fee, the chosen ticks and liquidity above 0. Report the
   tokenId, the range, the amounts used and what stayed in the wallet. A remainder
   always stays: what the swap paid above `amountOutMinimum`, and the part of the other
   token that would have matched it. The next rebalance redeploys it.

To add to an existing position, replace `mint` with `increaseLiquidity` on its tokenId.
The approvals are the same.

### Play: check-range

Report for each position whether it is in range, what it holds and what it has earned.
Parameters: network, tokenId (default: every position the wallet holds).

**Typical time:** reads only

1. List the positions: `balanceOf(wallet)` on the position manager, then
   `tokenOfOwnerByIndex(wallet, i)` for each index below it.
2. For each one read `positions(tokenId)`, then `getPool(token0, token1, fee)`, then
   `slot0()` on the pool.
3. In range when `tickLower <= tick < tickUpper`. Amounts held: `amount0(liquidity, s)`
   and `amount1(liquidity, s)`. Unclaimed fees: `eth_call`
   `collect((tokenId, wallet, 2^128 - 1, 2^128 - 1))` with `from` set to the wallet, and
   read the two return values.
4. Report pair and fee tier, in or out of range and on which side, the lower, current and
   upper price, the amounts held and the unclaimed fees. A position with liquidity 0 is
   closed but not burned. Say so instead of calling it out of range.

### Play: rebalance

Move an out-of-range position to a new range around the current price, in two batches.
Parameters: network, tokenId, width (default: the old range's width), slippage (default
0.5%).

**Typical time:** two batches

1. Run check-range. Stop when the position is in range. Stop too when the session's caps
   cannot cover batch two: exiting without re-entering gains nothing.
2. Batch one:
   `execute([decreaseLiquidity((tokenId, liquidity, amount0Min, amount1Min, deadline)), collect((tokenId, wallet, 2^128 - 1, 2^128 - 1)), burn(tokenId)])`
   with the full `liquidity` from `positions(tokenId)` and minimums from Range math.
3. Verify that the position manager's `balanceOf(wallet)` fell by one and
   `positions(tokenId)` now reverts. Read both token balances. They are the budget for
   batch two: the exit proceeds, the fees, and what earlier mints left behind. If the
   user holds other funds in those tokens, redeploy only what batch one added.
4. New range around the tick read now, with `d = (tickUpper - tickLower) / 2` of the old
   position unless the user gave a width.
5. Batch two: steps 2 to 4 of enter with those balances.
6. Verify as in enter. Report the old and new range, the amounts withdrawn and
   redeployed, and the fees collected.
7. If batch two fails, the funds sit in the wallet as tokens. Report that and the
   reason. Re-entering later is the enter play.

### Play: collect-fees

Move a position's earned fees into the wallet and leave the position as it is.
Parameters: network, tokenId.

**Typical time:** one batch

1. Preview the fees with the static `collect` call from check-range. Stop when both are
   0.
2. `execute([collect((tokenId, wallet, 2^128 - 1, 2^128 - 1))])`.
3. Verify both token balances rose by at least the preview and `liquidity` in
   `positions(tokenId)` is unchanged. Report the amounts.

## With the Sovereign Finance plugin for Hermes

The plugin loads this skill as `sovereign-finance:v3-range`. Its tools do the reads, the
math and the encoding above, so no calldata is built by hand. `network` is `bnb` or
`ethereum`, and the plugin maps it to mainnet or testnet from its mode. Amounts are
decimal strings in token units, such as `"100"` or `"0.25"`. Tokens are symbols.

| Play | Calls |
|---|---|
| list-pools | `sovereign_quote({network, kind: "pools", limit?})`. The rows come ranked, each marked inside or outside the session scope. |
| size-range | `sovereign_quote({network, kind: "lp-plan", pool, rangePct, budget})`, or `tickLower` and `tickUpper` in place of `rangePct`. Read the range from the result and send nothing. |
| enter | The same `lp-plan` quote with `budget` as `{symbol, amount}` and an optional `slippageBps`, then `sovereign_execute({network, actions})` with the returned `actions`. |
| check-range | `sovereign_positions({network})`. Each row has `tokenId`, `pool`, `pair`, `fee`, `tickLower`, `tickUpper`, `currentTick`, `inRange`, `amounts`, `unclaimedFees` and prices. |
| rebalance | `sovereign_quote({network, kind: "exit-plan", tokenId})`, `sovereign_execute`, then the `lp-plan` quote with `budget: "balances"`, `sovereign_execute`. |
| collect-fees | `sovereign_execute({network, actions})` with one `collect` action for the tokenId. |

- Start with `sovereign_status({network})`: wallet address, mode, balances, session
  status, expiry, scope and caps. If the session is missing or expired, or lacks a token
  or a cap the play needs, tell the user what to grant. Granting takes the user's
  passkey. The agent holds only the session key.
- Pass the `actions` array from a quote to `sovereign_execute` unchanged. Then call
  `sovereign_positions({network})` and report what it shows.
- `sovereign_execute` sends one batch with the session key. The plugin encodes the typed
  actions `wrap`, `unwrap`, `swap`, `mint`, `increase`, `decrease`, `collect` and `burn`
  and sets every recipient to the wallet.
- Approvals are implicit. The plugin adds the exact ones in the same batch, and there is
  no `approve` action.
- A `decrease` action carries `tokenId`, `token0`, `token1`, `liquidity` (the raw number
  from the position) and optional minimums, exactly as the `exit-plan` quote returns it.
- Each `sovereign_execute` call asks the user to approve a sentence built from the
  encoded batch. "Always" covers later batches for the same pool on that network.
- Two more actions reach outside this scope: `transfer` `{token, to, amount}` and `raw`
  `{to, data, value}`. The wallet refuses both onchain under the V3 LP session. No play
  uses them.
- `sovereign_quote({network, kind: "swap", tokenIn, tokenOut, fee, amountIn})` returns
  `amountOut` and `minAmountOut` for one swap. An `lp-plan` already contains the swap it
  needs.

A Hermes cron job runs the range check with this skill attached:

```text
/cron add "every 30m" "Check positions on both networks. Rebalance any that are out of range, following this skill. Otherwise answer with one line of status." --skill sovereign-finance:v3-range
```

Cron runs get the toolsets enabled for the `cron` platform in `hermes tools`, so the
plugin's tools must be on there. For the job to rebalance unattended, the user must have
approved that pool with "Always" in an earlier chat.

## Guards (do not remove)

- Onchain writes go through the session executor only. When the wallet or the relay
  refuses a call (`UnauthorizedCall`, `NoSpendPermissions`, `ExceededSpendLimit`, relay
  code 300), report the refusal and what it needs from the user, then stop. Never look
  for a way around it: no other router or contract, no `multicall`, no token `transfer`.
- Every `recipient` in a swap, mint or collect is the wallet's own address, written out
  in full. The zero address, and `address(2)` on SwapRouter02, leave the funds in the
  router or the position manager instead of the wallet.
- Approve exact amounts, in the same batch as the swap or mint that spends them. Never an
  unlimited approval.
- `amountOutMinimum` is a fresh quote minus slippage, never 0. Mint, increase and
  decrease minimums come from the slippage bounds in Range math and are 0 only where that
  math gives 0.
- Build each batch from reads made in the same run. `slot0()`, balances and quotes go
  stale within blocks.
- Verify every outcome from chain state (the position manager's `balanceOf`,
  `positions(tokenId)`, the token balances), never from a transaction result alone.
- Retry a reverted batch once, from fresh reads. Do not resend a batch whose result is
  unknown or pending until chain state shows it did not land. After that, stop and
  report.
- Rebalance only when `tickLower <= tick < tickUpper` is false. The user chooses pools
  and widths.
- Enter only pools that the factory in the address table returns from `getPool`.
