// The pane's own stylesheet, rendered in a style element inside the pane. Colour comes from Hermes
// theme variables only, so the pane follows every theme in light and dark. Class names are prefixed
// `sf-`. Dialogs are portaled out of the pane root, hence the separate `.sf-dialog` scope.

export const PANE_CSS = `
.sf-root,.sf-dialog{
  --sf-fg:var(--foreground);
  --sf-fg2:var(--ui-text-secondary);
  --sf-fg3:var(--ui-text-tertiary);
  --sf-line:var(--ui-stroke-secondary);
  --sf-accent:var(--ui-accent);
  --sf-red:var(--ui-red);
  --sf-green:var(--ui-green);
  --sf-yellow:var(--ui-yellow);
  --sf-mono:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  --sf-wash:color-mix(in srgb,var(--foreground) 4%,transparent);
  --sf-warn-text:color-mix(in srgb,var(--ui-yellow) 72%,var(--foreground));
  --sf-input-w:144px;
  --sf-cap-w:144px;
  color:var(--sf-fg);
  font-size:12px;
  line-height:1.5;
  text-align:left;
}
.sf-root *,.sf-root *::before,.sf-root *::after,.sf-dialog *,.sf-dialog *::before,.sf-dialog *::after{box-sizing:border-box}
:where(.sf-root,.sf-dialog) :where(h2,h3,p,ul,ol,dl,li):where([class^="sf-"],[class*=" sf-"]),
:where(ul).sf-dialog,
:where(.sf-scope,.sf-confirm-list) > li,
:where(.sf-kv,.sf-ledger) :where(dt,dd){margin:0;padding:0;list-style:none}

.sf-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;container:sf / inline-size}

.sf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sf-dim{color:var(--sf-fg3)}
.sf-strong{font-weight:600}
.sf-mono{font-family:var(--sf-mono);font-variant-ligatures:none}
.sf-copy{color:var(--sf-fg2);max-width:52ch}
.sf-hint{color:var(--sf-fg3);font-size:11px;line-height:1.45;text-wrap:balance}
.sf-label{color:var(--sf-fg2)}
.sf-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}

.sf-amt{display:inline-flex;align-items:baseline;gap:.4em;white-space:nowrap;-webkit-user-select:text;user-select:text}
.sf-num{font-family:var(--sf-mono);font-variant-numeric:tabular-nums;font-variant-ligatures:none;white-space:nowrap}
.sf-sym{color:var(--sf-fg2);font-size:11px}
.sf-amt[data-strong] .sf-num,.sf-num[data-strong]{font-weight:600}

.sf-alert{display:flex;align-items:flex-start;gap:6px;font-size:11.5px;line-height:1.45;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.sf-alert svg{flex:none;width:13px;height:13px;margin-top:2px}
.sf-alert[data-tone=error]{color:var(--sf-red)}
.sf-alert[data-tone=warn]{color:var(--sf-warn-text)}
.sf-alert[data-tone=warn] svg{color:var(--sf-yellow)}

.sf-links{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px;row-gap:2px}
.sf-link-wrap{display:inline-flex;align-items:center;gap:4px}
.sf-link{display:inline-flex;align-items:center;gap:3px;margin:0;padding:0;border:0;border-radius:2px;background:none;font:inherit;font-size:11.5px;color:var(--sf-accent);cursor:pointer;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 28%,transparent);text-underline-offset:3px}
.sf-link:hover{text-decoration-color:currentColor}
.sf-link svg{flex:none;width:11px;height:11px}
.sf-link:focus-visible,.sf-step-head:focus-visible,.sf-asset:focus-visible{outline:2px solid var(--sf-accent);outline-offset:2px}

.sf-hex{display:inline-flex;align-items:center;gap:2px;min-width:0;max-width:100%}
.sf-hex-text{display:flex;min-width:0;font-family:var(--sf-mono);font-size:11.5px;font-variant-ligatures:none;white-space:nowrap;-webkit-user-select:text;user-select:text}
.sf-hex-head{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sf-hex-tail{flex:none}

/* Header and the strips pinned under it */
.sf-header{flex:none;display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-bottom:1px solid var(--sf-line)}
.sf-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.sf-strip{flex:none;padding:8px 16px;border-bottom:1px solid var(--sf-line)}

.sf-job{flex:none;display:grid;grid-template-columns:18px minmax(0,1fr);column-gap:10px;max-height:60%;overflow-y:auto;padding:10px 16px 12px;border-bottom:1px solid var(--sf-line);background:var(--sf-wash)}
.sf-job[data-tone=wait]{background:color-mix(in srgb,var(--sf-accent) 7%,transparent)}
.sf-job[data-tone=done]{background:color-mix(in srgb,var(--sf-green) 9%,transparent)}
.sf-job[data-tone=partial]{background:color-mix(in srgb,var(--sf-yellow) 10%,transparent)}
.sf-job[data-tone=error]{background:color-mix(in srgb,var(--sf-red) 8%,transparent)}
.sf-job-busy{padding-top:14px;padding-bottom:16px;background:color-mix(in srgb,var(--sf-accent) 9%,transparent);border-bottom:2px solid var(--sf-accent)}
.sf-job-busy .sf-job-title{font-size:14px}
.sf-job-dots{display:flex;gap:6px;margin-top:2px}
.sf-job-dots span{width:22px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--sf-accent) 22%,transparent)}
.sf-job-dots span[data-state=done]{background:var(--sf-accent)}
.sf-job-dots span[data-state=now]{background:var(--sf-accent);animation:sf-blink 1.1s ease-in-out infinite}
.sf-job-bar{position:relative;height:2px;margin-top:4px;overflow:hidden;border-radius:1px;background:color-mix(in srgb,var(--sf-accent) 16%,transparent)}
.sf-job-bar::after{content:"";position:absolute;inset:0 auto 0 0;width:35%;background:var(--sf-accent);animation:sf-slide 1.4s ease-in-out infinite}
@keyframes sf-slide{0%{transform:translateX(-100%)}100%{transform:translateX(290%)}}
@keyframes sf-blink{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.sf-job-bar::after,.sf-job-dots span[data-state=now]{animation:none}}
.sf-content[data-busy]{opacity:.45;pointer-events:none;transition:opacity .2s}
.sf-job-icon{display:flex;align-items:center;justify-content:center;height:20px}
.sf-job[data-tone=done] .sf-job-icon{color:var(--sf-green)}
.sf-job[data-tone=partial] .sf-job-icon{color:var(--sf-yellow)}
.sf-job[data-tone=error] .sf-job-icon{color:var(--sf-red)}
.sf-job-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.sf-job-title{font-size:13px;font-weight:600;line-height:20px}
.sf-job-step{font-size:12.5px;line-height:20px;overflow-wrap:anywhere}
.sf-job-detail{color:var(--sf-fg2);overflow-wrap:anywhere;white-space:pre-wrap;-webkit-user-select:text;user-select:text}
.sf-job-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.sf-job-fallback{display:flex;flex-direction:column;gap:2px;margin-top:4px;color:var(--sf-fg2)}
.sf-job-url{display:flex;align-items:center;gap:2px;min-width:0}
.sf-job-url code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--sf-mono);font-size:11px;-webkit-user-select:text;user-select:text}
.sf-pulse{position:relative;width:8px;height:8px;border-radius:50%;background:var(--sf-accent)}
.sf-pulse::after{content:"";position:absolute;inset:-5px;border:1px solid var(--sf-accent);border-radius:50%;opacity:0;animation:sf-pulse 1.8s ease-out infinite}
@keyframes sf-pulse{0%{transform:scale(.45);opacity:.75}100%{transform:scale(1.15);opacity:0}}
@media (prefers-reduced-motion:reduce){.sf-pulse::after{animation:none}.sf-step-caret{transition:none}}
.sf-legs{display:flex;flex-direction:column;gap:8px;margin-top:2px}
.sf-leg{display:grid;grid-template-columns:minmax(0,auto) auto minmax(0,1fr);align-items:center;column-gap:8px;row-gap:2px}
.sf-leg-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-leg-charged{justify-self:end;white-space:nowrap}
.sf-leg .sf-links,.sf-leg-error{grid-column:1 / -1}
.sf-leg-error{color:var(--sf-red);font-size:11.5px;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.sf-leg-inline{display:flex;flex-wrap:wrap;align-items:center;gap:12px}

/* Scrolling body */
.sf-scroll{flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px 8px 28px 16px}
.sf-content{display:flex;flex-direction:column;gap:14px;transition:opacity .12s ease}
.sf-content[data-pending]{opacity:.45;pointer-events:none}
.sf-loading{display:flex;flex-direction:column;gap:18px;padding-top:4px}
.sf-loading-row{display:flex;align-items:center;gap:12px}
.sf-failed{display:grid;place-items:center;min-height:100%;padding:24px 8px}
.sf-failed-actions{display:flex;justify-content:center}

/* Steps */
.sf-steps{display:flex;flex-direction:column}
.sf-step{display:grid;grid-template-columns:20px minmax(0,1fr);column-gap:12px}
.sf-step-marker{grid-column:1;grid-row:1;display:grid;place-items:center;width:20px;height:20px;margin-top:4px;border-radius:3px;box-shadow:inset 0 0 0 1px var(--sf-line);color:var(--sf-fg2);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}
.sf-step[data-status=current] .sf-step-marker{background:var(--sf-fg);box-shadow:none;color:var(--background)}
.sf-step[data-status=done] .sf-step-marker{background:color-mix(in srgb,var(--sf-accent) 14%,transparent);box-shadow:none;color:var(--sf-accent)}
.sf-step[data-status=locked] .sf-step-marker{color:var(--sf-fg3)}
.sf-step-head{grid-column:2;grid-row:1;display:flex;align-items:center;gap:8px;width:100%;min-height:28px;margin:0;padding:0;border:0;border-radius:2px;background:none;color:inherit;font:inherit;text-align:left}
button.sf-step-head{cursor:pointer}
.sf-step-title{flex:none;font-size:13px;font-weight:600}
.sf-step[data-status=locked] .sf-step-title{color:var(--sf-fg3);font-weight:500}
.sf-step-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--sf-fg3);font-size:11px}
.sf-step-summary .sf-sym{font-size:inherit;color:inherit}
.sf-summary-nums{display:inline-flex;gap:10px}
.sf-step-caret{flex:none;margin-left:auto;color:var(--sf-fg3);transition:transform .12s ease}
.sf-step-summary + .sf-step-caret{margin-left:0}
.sf-step-head[aria-expanded=true] .sf-step-caret{transform:rotate(90deg)}
button.sf-step-head:hover .sf-step-caret{color:var(--sf-fg)}
.sf-step-rail{grid-column:1;grid-row:2;justify-self:center;width:1px;min-height:10px;margin:4px 0;background:var(--sf-line)}
.sf-step:last-child .sf-step-rail{visibility:hidden}
.sf-step-body{grid-column:2;grid-row:2;display:flex;flex-direction:column;gap:10px;min-width:0}
.sf-step-body:not(:empty){padding:4px 0 18px}
.sf-step:last-child .sf-step-body:not(:empty){padding-bottom:4px}

/* Step 1 */
.sf-wallet{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.sf-wallet-main{display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0}
.sf-address{display:block;max-width:25ch;font-family:var(--sf-mono);font-size:12px;font-variant-ligatures:none;line-height:1.6;-webkit-user-select:text;user-select:text}
.sf-address span{display:inline-block;margin-right:.45ch}
.sf-qr{flex:none;display:block;width:96px;height:96px;border-radius:4px;box-shadow:0 0 0 1px var(--sf-line)}

/* Step 2 */
.sf-fund-address{display:flex;align-items:center;gap:8px;min-width:0}
.sf-badges{flex:none;display:flex;gap:4px}
.sf-nets{display:flex;flex-direction:column;border-block:1px solid var(--sf-line)}
.sf-net{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12px;row-gap:4px;padding:8px 0}
.sf-net + .sf-net{border-top:1px solid var(--sf-line)}
.sf-net-id{display:flex;flex-direction:column;gap:2px;min-width:0}
.sf-net-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-net-figures{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.sf-net-balance{display:flex;align-items:center;min-height:18px}
.sf-net-balance .sf-num{font-size:13px}
.sf-net-token{color:var(--sf-fg2)}
.sf-net-asof{min-height:16px;color:var(--sf-fg3);font-size:11px;white-space:nowrap}
.sf-net-error{grid-column:1 / -1}

/* Step 3 */
.sf-form{display:flex;flex-direction:column;gap:12px}
.sf-field{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 10px}
.sf-field .sf-field-error{grid-column:1 / -1;text-align:right}
.sf-days{width:var(--sf-cap-w)}
.sf-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
.sf-col{display:flex;flex-direction:column;gap:8px;min-width:0;padding-top:10px;border-top:1px solid var(--sf-line)}
.sf-col-title{font-weight:600}
.sf-cap{display:grid;grid-template-columns:minmax(0,1fr) var(--sf-cap-w);align-items:center;gap:3px 8px}
.sf-cap .sf-hint,.sf-cap .sf-field-error{grid-column:1 / -1;text-align:right}
.sf-token{display:grid;grid-template-columns:16px minmax(0,1fr) var(--sf-input-w);align-items:center;gap:3px 8px}
.sf-token .sf-field-error{grid-column:1 / -1;text-align:right}
.sf-token-name{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;min-width:0;cursor:pointer}
.sf-token-name .sf-dim{font-size:11px;white-space:nowrap}
.sf-num-input{font-family:var(--sf-mono);font-variant-numeric:tabular-nums;text-align:right}
.sf-mono-input{font-family:var(--sf-mono);font-variant-ligatures:none}
.sf-invalid{border-color:var(--sf-red)}
.sf-field-error{color:var(--sf-red);font-size:11px;line-height:1.4}
.sf-submit{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
.sf-submit .sf-hint{flex:1 1 140px;min-width:0}
.sf-review{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:4px;background:var(--sf-wash)}
.sf-review-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sf-review-name{color:var(--sf-fg2);font-weight:600;margin-bottom:2px}
.sf-scope{display:flex;flex-direction:column;gap:2px;-webkit-user-select:text;user-select:text}
.sf-scope li{position:relative;padding-left:12px;overflow-wrap:anywhere}
.sf-scope li::before{content:"";position:absolute;left:1px;top:.62em;width:4px;height:4px;border-radius:1px;background:var(--sf-fg3)}
@container sf (min-width:440px){
  .sf-form{--sf-input-w:96px;--sf-cap-w:136px}
  .sf-cols{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
}

/* Step 4 */
.sf-costs{display:flex;flex-direction:column}
.sf-cost{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-top:1px solid var(--sf-line)}
.sf-cost:last-child{border-bottom:1px solid var(--sf-line)}
.sf-cost-head{display:flex;align-items:center;gap:8px}
.sf-cost-head label{cursor:pointer}
.sf-cost .sf-kv,.sf-cost .sf-alert{padding-left:24px}
.sf-cost[data-off] .sf-kv{opacity:.55}
.sf-kv{display:flex;flex-direction:column;gap:3px}
.sf-kv > div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.sf-kv dt{display:flex;align-items:center;gap:6px;color:var(--sf-fg2);white-space:nowrap}
.sf-kv dd{min-width:0;text-align:right}
.sf-kv-total dt{color:var(--sf-fg);font-weight:600}
.sf-confirm-list{display:flex;flex-direction:column;border-block:1px solid var(--sf-line)}
.sf-confirm-list li{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:8px 0}
.sf-confirm-list li + li{border-top:1px solid var(--sf-line)}

/* Agent sessions */
.sf-live{display:flex;flex-direction:column;gap:10px;padding-top:14px;border-top:1px solid var(--sf-line)}
.sf-section-title{font-size:13px;font-weight:600}
.sf-cards{display:flex;flex-direction:column;gap:12px}
.sf-plays{display:flex;flex-direction:column;gap:6px;margin-top:4px;padding-top:10px;border-top:1px solid var(--sf-line)}
.sf-plays-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.sf-play-list{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
.sf-play{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px solid color-mix(in srgb,var(--sf-line) 60%,transparent)}
.sf-play:first-child{border-top:0}
.sf-play-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sf-play-title{font-size:12.5px;font-weight:600}
.sf-play-blurb{color:var(--sf-fg2);font-size:12px;line-height:1.4}
.sf-play-fields{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px}
.sf-play-field{width:150px}
.sf-play-field:nth-of-type(2){width:104px}
.sf-play-note{color:var(--sf-accent);font-size:11.5px;margin-top:2px}
.sf-play-actions{flex:none;display:flex;flex-direction:column;gap:4px;align-items:stretch}
.sf-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--sf-line);border-radius:4px}
.sf-card-head{display:flex;align-items:center;gap:10px;min-height:22px}
.sf-card-net{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.sf-card-status{flex:none;display:inline-flex;align-items:center;gap:6px;margin-right:auto;color:var(--sf-fg2)}
.sf-card-expiry{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0 12px}
.sf-card[data-status=revoked] .sf-scope,.sf-card[data-status=expired] .sf-scope{color:var(--sf-fg3)}
.sf-card-foot{display:flex;flex-direction:column;gap:4px}
.sf-card-key{display:flex;align-items:center;gap:8px;min-width:0}
.sf-positions{display:flex;flex-direction:column;margin-top:2px;border-top:1px solid var(--sf-line)}
.sf-pos{display:flex;flex-direction:column;gap:6px;padding-top:10px}
.sf-pos + .sf-pos{margin-top:10px;border-top:1px solid var(--sf-line)}
.sf-pos-head{display:flex;align-items:center;gap:8px}
.sf-pos-pair{font-weight:600}
.sf-pos-fee{margin-right:auto;color:var(--sf-fg2);font-family:var(--sf-mono);font-size:11.5px}
.sf-range{position:relative;height:14px;margin:2px 0 0}
.sf-range::before{content:"";position:absolute;left:0;right:0;top:6px;height:2px;border-radius:1px;background:var(--sf-line)}
.sf-range-band{position:absolute;left:14%;right:14%;top:4px;height:6px;border-radius:2px;background:color-mix(in srgb,var(--sf-fg3) 45%,transparent)}
.sf-range[data-in] .sf-range-band{background:color-mix(in srgb,var(--sf-green) 40%,transparent)}
.sf-range-mark{position:absolute;top:0;width:2px;height:14px;margin-left:-1px;border-radius:1px;background:var(--sf-yellow)}
.sf-range[data-in] .sf-range-mark{background:var(--sf-green)}
.sf-pos-prices{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:8px;color:var(--sf-fg2);-webkit-user-select:text;user-select:text}
.sf-pos-prices > :nth-child(2){text-align:center;align-items:center}
.sf-pos-prices > :last-child{text-align:right;align-items:flex-end}
.sf-pos-current{display:flex;flex-direction:column;align-items:flex-start;color:var(--sf-fg)}
.sf-pos-current .sf-dim{font-size:11px;white-space:nowrap}
.sf-ledger{display:grid;column-gap:14px;row-gap:3px;align-items:baseline}
.sf-ledger > div{display:contents}
.sf-ledger dt{color:var(--sf-fg2);white-space:nowrap}
.sf-ledger dd{min-width:0;overflow:hidden;text-align:right}
.sf-ledger .sf-amt{max-width:100%}
.sf-ledger .sf-num{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sf-pos-foot{display:flex;flex-wrap:wrap;gap:0 10px;font-size:11px}
.sf-empty{margin-top:2px;padding-top:10px;border-top:1px solid var(--sf-line);color:var(--sf-fg3)}

/* Dialog bodies */
.sf-dialog-shell{max-width:26rem}
.sf-stack{display:flex;flex-direction:column;gap:4px}
.sf-label-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.sf-assets{display:flex;flex-direction:column;border-block:1px solid var(--sf-line)}
.sf-asset{display:grid;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;margin:0;padding:7px 2px;border:0;border-radius:2px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sf-asset + .sf-asset{border-top:1px solid var(--sf-line)}
.sf-asset:disabled{cursor:default;opacity:.5}
.sf-asset-dot{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--sf-fg3)}
.sf-asset[aria-checked=true] .sf-asset-dot{box-shadow:inset 0 0 0 4px var(--sf-accent)}
.sf-asset:enabled:hover .sf-asset-dot{box-shadow:inset 0 0 0 1px var(--sf-fg)}
.sf-asset[aria-checked=true]:enabled:hover .sf-asset-dot{box-shadow:inset 0 0 0 4px var(--sf-accent)}
`
