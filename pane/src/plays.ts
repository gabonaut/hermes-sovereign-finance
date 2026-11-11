// Starter requests for the agent. Each play is a title, one line of what it does, and the sentence
// it writes into the chat box. Nothing here signs or sends: the agent still plans the batch and
// Hermes still asks for approval. To add a play of your own, add an entry to PLAYS.

import type { NetworkState } from './types'

export interface PlayContext {
  /** "bnb" or "ethereum", as the agent's tools name the network. */
  network: string
  networkName: string
  native: string
  /** The pair a new position defaults to, like "USDT/WBNB". */
  pair: string
  amount: string
  rangePct: string
}

export interface Play {
  id: string
  title: string
  blurb: string
  /** Shows the amount and range fields. */
  sized?: boolean
  /** Buttons, each with the request it writes. */
  actions: { label: string; request: (c: PlayContext) => string }[]
}

export const PLAYS: Play[] = [
  {
    id: 'find',
    title: 'Find a pool',
    blurb: 'Ranks the most traded pools by fee income and suggests one.',
    actions: [
      {
        label: 'Ask',
        request: c =>
          `List the most traded V3 pools on ${c.network} with their fee APR, and tell me which one you would pick for a small position and why.`
      }
    ]
  },
  {
    id: 'open',
    title: 'Open a position',
    blurb: 'Wraps, swaps half and provides liquidity around the current price, in one batch.',
    sized: true,
    actions: [
      {
        label: 'Ask',
        request: c =>
          `Open a liquidity position in the ${c.pair} pool on ${c.network} with ${c.amount} ${c.native}, ${c.rangePct}% either side of the price.`
      }
    ]
  },
  {
    id: 'keep',
    title: 'Keep it in range',
    blurb: 'Closes a position the price has left and reopens it around the current price.',
    actions: [
      {
        label: 'Now',
        request: c => `Check my positions on ${c.network}. Close any that is out of range and reopen it around the current price.`
      },
      {
        label: 'Every 30 min',
        request: c =>
          `Set up a scheduled job that runs every 30 minutes with the sovereign-finance:v3-range skill: check my positions on ${c.network}, close any that is out of range and reopen it around the current price, otherwise answer with one line of status.`
      }
    ]
  },
  {
    id: 'compound',
    title: 'Compound fees',
    blurb: 'Collects the fees a position has earned and adds them back to it.',
    actions: [
      { label: 'Ask', request: c => `Collect the fees my positions on ${c.network} have earned and add them back to the same positions.` }
    ]
  },
  {
    id: 'exit',
    title: 'Cash out',
    blurb: 'Closes every position and swaps everything back to the native coin.',
    actions: [
      { label: 'Ask', request: c => `Close all my positions on ${c.network} and swap everything back to ${c.native}.` }
    ]
  }
]

const STABLES = ['USDT', 'USDC', 'BUSD']

/** Sensible defaults for a network: its wrapped coin against the first stablecoin it knows, and a small amount. */
export function defaultsFor(network: NetworkState): Pick<PlayContext, 'pair' | 'amount' | 'rangePct'> {
  const symbols = (network.balances?.tokens ?? []).map(t => t.symbol)
  const wrapped = symbols.find(s => s === 'WBNB' || s === 'WETH') ?? (network.key === 'bnb' ? 'WBNB' : 'WETH')
  const stable = STABLES.find(s => symbols.includes(s)) ?? (network.key === 'bnb' ? 'USDT' : 'USDC')
  return { pair: `${stable}/${wrapped}`, amount: network.key === 'bnb' ? '0.002' : '0.001', rangePct: '3' }
}
