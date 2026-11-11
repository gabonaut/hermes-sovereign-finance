import { Badge, Button, CopyButton, Loader } from '@hermes/plugin-sdk'

import { isLoopbackUrl } from './format'
import { IconAlert, IconCheck } from './icons'
import { passkeyKey } from './store'
import type { ActivateLeg, Job, NetworkState } from './types'
import { ExtLink, Hex, InlineError, Num, useAction, usePane } from './ui'

const DONE_TITLE: Record<string, string> = {
  create: 'Wallet created',
  recover: 'Wallet recovered',
  revoke: 'Session revoked',
  withdraw: 'Withdrawal sent'
}

const ERROR_TITLE: Record<string, string> = {
  create: 'Wallet creation failed',
  recover: 'Recovery failed',
  activate: 'Activation failed',
  revoke: 'Revoke failed',
  withdraw: 'Withdrawal failed'
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function activationSummary(legs: ActivateLeg[]): { title: string; tone: 'done' | 'partial' | 'error' } {
  const confirmed = legs.filter(leg => leg.status === 'confirmed').length
  if (legs.length === 0) return { title: 'Activation finished', tone: 'done' }
  if (confirmed === legs.length) return { title: `Activated on ${plural(confirmed, 'network')}`, tone: 'done' }
  if (confirmed === 0) return { title: `Activation failed on ${plural(legs.length, 'network')}`, tone: 'error' }
  return { title: `Activated on ${confirmed} of ${legs.length} networks`, tone: 'partial' }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface JobBannerProps {
  job: Job
  networks: NetworkState[]
  /** The passkey key (job id and URL) the browser could not be opened for, if any. */
  openFailed: string | null
}

const RUNNING_TITLE: Record<string, string> = {
  create: 'Creating the wallet',
  recover: 'Recovering the wallet',
  activate: 'Activating',
  revoke: 'Revoking',
  withdraw: 'Sending'
}

export function JobBanner({ job, networks, openFailed }: JobBannerProps) {
  const { store } = usePane()
  const cancel = useAction()
  const dismiss = useAction()
  const reopen = useAction()
  const nameOf = (key: string) => networks.find(n => n.key === key)?.name ?? key

  const dismissButton = (
    <Button
      loading={dismiss.busy}
      onClick={() => void dismiss.run(() => store.post('/job/dismiss', {}))}
      size="sm"
      type="button"
      variant="outline"
    >
      Dismiss
    </Button>
  )

  if (job.status === 'waiting_passkey') {
    const url = job.passkeyUrl
    const local = isLoopbackUrl(url)
    const failed = openFailed !== null && openFailed === passkeyKey(job)
    return (
      <section aria-live="polite" className="sf-job" data-tone="wait">
        <span className="sf-job-icon">
          <span className="sf-pulse" />
        </span>
        <div className="sf-job-main">
          <div className="sf-job-title">Approve with your passkey in the browser</div>
          {job.passkeyPrompt ? <div className="sf-job-detail">{job.passkeyPrompt}</div> : null}
          {url && !local ? <div className="sf-job-detail">The approval page is on {hostOf(url)}.</div> : null}
          <div className="sf-job-actions">
            {url ? (
              <Button
                loading={reopen.busy}
                onClick={() => void reopen.run(() => store.reopenPasskey())}
                size="sm"
                type="button"
              >
                {local ? 'Reopen' : 'Open approval page'}
              </Button>
            ) : null}
            <Button
              loading={cancel.busy}
              onClick={() => void cancel.run(() => store.post('/job/cancel', {}))}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
          {failed && url ? (
            <div className="sf-job-fallback">
              <span>The browser did not open. Copy the link and open it yourself.</span>
              <span className="sf-job-url">
                <code>{url}</code>
                <CopyButton appearance="icon" buttonSize="icon-xs" label="Copy link" text={url} />
              </span>
            </div>
          ) : null}
          {cancel.error ? <InlineError>{cancel.error}</InlineError> : null}
        </div>
      </section>
    )
  }

  if (job.status === 'running') {
    // "step 2 of 3" in the step text becomes a row of dots, so a staged activation shows where it is.
    const staged = /step (\d+) of (\d+)/i.exec(job.step ?? '')
    const at = staged ? Number(staged[1]) : 0
    const of = staged ? Number(staged[2]) : 0
    return (
      <section aria-live="polite" className="sf-job sf-job-busy" data-tone="run">
        <span className="sf-job-icon">
          <Loader label="Working" style={{ width: 18, height: 18 }} />
        </span>
        <div className="sf-job-main">
          <div className="sf-job-title">{RUNNING_TITLE[job.kind] ?? 'Working'}</div>
          <div className="sf-job-step">{job.step || 'Working'}</div>
          {of > 1 ? (
            <div aria-hidden="true" className="sf-job-dots">
              {Array.from({ length: of }, (_, i) => (
                <span data-state={i + 1 < at ? 'done' : i + 1 === at ? 'now' : 'next'} key={i} />
              ))}
            </div>
          ) : null}
          <div className="sf-job-bar" />
          <div className="sf-job-detail">
            {job.kind === 'activate'
              ? 'Keep the browser tab open. It asks for each approval in turn, and this can take a minute or two.'
              : 'Waiting for the network to confirm.'}
          </div>
        </div>
      </section>
    )
  }

  if (job.status === 'error') {
    return (
      <section aria-live="polite" className="sf-job" data-tone="error">
        <span className="sf-job-icon">
          <IconAlert height={16} width={16} />
        </span>
        <div className="sf-job-main">
          <div className="sf-job-title">{ERROR_TITLE[job.kind] ?? 'The request failed'}</div>
          <div className="sf-job-detail">{job.error?.message || job.error?.code || job.step || 'No reason was given.'}</div>
          <div className="sf-job-actions">{dismissButton}</div>
          {dismiss.error ? <InlineError>{dismiss.error}</InlineError> : null}
        </div>
      </section>
    )
  }

  const result = job.result
  const legs = result?.legs ?? []
  const summary = job.kind === 'activate' ? activationSummary(legs) : { title: DONE_TITLE[job.kind] ?? 'Done', tone: 'done' as const }

  return (
    <section aria-live="polite" className="sf-job" data-tone={summary.tone}>
      <span className="sf-job-icon">
        {summary.tone === 'done' ? <IconCheck height={16} width={16} /> : <IconAlert height={16} width={16} />}
      </span>
      <div className="sf-job-main">
        <div className="sf-job-title">{summary.title}</div>
        {result?.address ? (
          <div className="sf-job-detail">
            <Hex copyLabel="Copy address" fit value={result.address} />
          </div>
        ) : null}
        {legs.length > 0 ? (
          <ul className="sf-legs">
            {legs.map(leg => (
              <li className="sf-leg" key={leg.network}>
                <span className="sf-leg-name">{nameOf(leg.network)}</span>
                <Badge variant={leg.status === 'confirmed' ? 'success' : 'destructive'}>
                  {leg.status === 'confirmed' ? 'Confirmed' : leg.status === 'failed' ? 'Failed' : leg.status}
                </Badge>
                {leg.charged ? (
                  <span className="sf-leg-charged">
                    <span className="sf-dim">Charged</span> <Num symbol={leg.nativeSymbol} value={leg.charged} />
                  </span>
                ) : null}
                <span className="sf-links">
                  <ExtLink href={leg.txUrl}>Transaction</ExtLink>
                  <ExtLink href={leg.keystoreKeyUrl}>Keystore</ExtLink>
                </span>
                {leg.error ? <span className="sf-leg-error">{leg.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {result?.network && legs.length === 0 ? (
          <div className="sf-job-detail sf-leg-inline">
            <span>{nameOf(result.network)}</span>
            <ExtLink href={result.txUrl}>Transaction</ExtLink>
          </div>
        ) : null}
        <div className="sf-job-actions">{dismissButton}</div>
        {dismiss.error ? <InlineError>{dismiss.error}</InlineError> : null}
      </div>
    </section>
  )
}
