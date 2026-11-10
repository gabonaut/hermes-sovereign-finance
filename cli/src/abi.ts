// ABIs and the function signatures the session scope is built from.
import { parseAbi, toFunctionSelector, type Hex } from "viem";

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
]);

export const wrappedAbi = parseAbi(["function deposit() payable", "function withdraw(uint256 amount)"]);

// PancakeSwap V3 SwapRouter: the params struct carries a deadline.
export const pancakeRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

// Uniswap SwapRouter02: no deadline in the struct.
export const uniswapRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

// NonfungiblePositionManager: identical on PancakeSwap V3 and Uniswap V3.
export const positionManagerAbi = parseAbi([
  "struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }",
  "struct IncreaseLiquidityParams { uint256 tokenId; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }",
  "struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }",
  "struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity(IncreaseLiquidityParams params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) payable",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

// slot0 differs: PancakeSwap packs feeProtocol into a uint32, Uniswap into a uint8.
export const pancakePoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
export const uniswapPoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

export const factoryAbi = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);

export const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const keyStoreAbi = parseAbi([
  "function getKeys(address user) view returns (bytes32[])",
  "function isValidKey(address user, bytes32 keyId) view returns (bool)",
  "function getPublicKey(address user, bytes32 keyId) view returns (bytes)",
]);
export const controllerAbi = parseAbi(["function getRegistrationFeeInWei() view returns (uint256)"]);

/** Function signatures behind the session scope. Selectors are derived from these, never typed by hand. */
export const SIG = {
  approve: "approve(address,uint256)",
  transfer: "transfer(address,uint256)",
  deposit: "deposit()",
  withdraw: "withdraw(uint256)",
  pancakeSwap: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
  uniswapSwap: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  mint: "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))",
  increaseLiquidity: "increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))",
  decreaseLiquidity: "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
  collect: "collect((uint256,address,uint128,uint128))",
  burn: "burn(uint256)",
} as const;

export const selectorOf = (signature: string): Hex => toFunctionSelector(`function ${signature}`);

export const SEL = Object.fromEntries(Object.entries(SIG).map(([k, v]) => [k, selectorOf(v)])) as Record<keyof typeof SIG, Hex>;

/** Errors the wallet contract raises when a session steps outside its scope or caps. */
export const ACCOUNT_ERRORS = parseAbi([
  "error UnauthorizedCall(bytes32 keyHash, address target, bytes data)",
  "error ExceededSpendLimit(address token)",
  "error NoSpendPermissions()",
  "error Unauthorized()",
  "error KeyDoesNotExist()",
  "error KeyHashIsZero()",
  "error CannotSelfExecute()",
  "error InsufficientBalance()",
]);
