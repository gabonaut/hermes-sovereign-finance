import type { HermesPlugin } from '@hermes/plugin-sdk'

import { Pane } from './app'
import { createStore, PANE_ID, PLUGIN_ID } from './store'

const PANE_WIDTH = '26rem'
const PANE_MIN_WIDTH = '20rem'
const PANE_MAX_WIDTH = '36rem'

const plugin: HermesPlugin = {
  id: PLUGIN_ID,
  name: 'Sovereign Finance',
  description:
    'A self-custodial Altana smart wallet on BNB Chain and Ethereum. Your passkey is the admin key. The agent holds a session key with onchain limits.',
  register(ctx) {
    const store = createStore(ctx)

    ctx.register({
      id: PANE_ID,
      area: 'panes',
      title: 'Sovereign Finance',
      // A right-hand side panel with a bounded width, so it never takes the chat's place.
      data: {
        placement: 'right',
        collapsible: true,
        dock: { pane: 'workspace', pos: 'right' },
        width: PANE_WIDTH,
        minWidth: PANE_MIN_WIDTH,
        maxWidth: PANE_MAX_WIDTH
      },
      render: () => <Pane ctx={ctx} store={store} />
    })
  }
}

export default plugin
