import type { HermesPlugin } from '@hermes/plugin-sdk'

import { Pane } from './app'
import { createStore, PANE_ID, PLUGIN_ID } from './store'

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
      data: { placement: 'right' },
      render: () => <Pane ctx={ctx} store={store} />
    })
  }
}

export default plugin
