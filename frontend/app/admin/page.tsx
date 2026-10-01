'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestStatusBadge } from '@/components/Badges';
import { useRequireRole } from '@/components/Session';
import { api, fmtDate, fmtTime, money, RequestDetail, RequestRow, ResolveBody, Stats } from '@/lib/api';

// The review queue comes first (oldest waiting on top): it's the agent's actual work.
const FILTERS: Array<{ key: string; label: string; params: Record<string, string>; count: (s: Stats) => number }> = [
  { key: 'pending', label: 'Needs review', params: { status: 'pending_review' }, count: (s) => s.pending_review },
  { key: 'all', label: 'All', params: {}, count: (s) => s.total },
  { key: 'APPROVED', label: 'Auto-approved', params: { decision: 'APPROVED' }, count: (s) => s.approved },
  { key: 'DENIED', label: 'Auto-denied', params: { decision: 'DENIED' }, count: (s) => s.denied },
  { key: 'ESCALATED', label: 'Escalated', params: { decision: 'ESCALATED' }, count: (s) => s.escalated },
];
const PAGE = 50;
const MAX_REFRESH = 200;

/** "12 min", "3 h", "2 d": how long a pending request has been waiting. */
function fmtAge(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} d`;
}

const EVENT_LABEL: Record<string, string> = {
  request_received: 'Request received & input guard',
  ai_assessment: 'AI classification',
  policy_evaluated: 'Policy engine decision',
  reply_generated: 'Customer reply generated',
  decision_recorded: 'Decision recorded',
  agent_approved: 'Agent approved',
  agent_denied: 'Agent denied',
};

export default function AdminPage() {
  const session = useRequireRole('agent');
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Errors from the agent's own actions stay until their next action; background refresh failures are separate
  // so a successful refresh never wipes an error the agent is reading.
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A refresh that started before "Load more" (or a filter change) must not overwrite the newer list.
  const listSeq = useRef(0);
  const rowCount = useRef(0);
  rowCount.current = rows.length;
  // Responses for a request that is no longer selected are dropped (clicking quickly through rows).
  const selectedRef = useRef<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  // 401s are handled centrally (redirect to /login in lib/api.ts); everything else is shown inline.
  const handleErr = useCallback((e: unknown) => setError((e as Error).message), []);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!session) return;
      try {
        const d = await api.requestDetail(id);
        if (selectedRef.current === id) setDetail(d);
      } catch (e) {
        handleErr(e);
      }
    },
    [session, handleErr],
  );

  // Reloads everything currently shown (up to MAX_REFRESH rows) so paging back isn't undone by the poll.
  const refresh = useCallback(async () => {
    if (!session) return;
    const seq = listSeq.current;
    const params = { ...(FILTERS.find((f) => f.key === filter)?.params ?? {}), limit: String(Math.min(MAX_REFRESH, Math.max(PAGE, rowCount.current))) };
    try {
      const [s, page] = await Promise.all([api.stats(), api.listRequests(params)]);
      setStats(s);
      if (seq === listSeq.current) {
        setRows(page.items);
        setNextCursor(page.nextCursor);
      }
      setRefreshError(null);
    } catch (e) {
      setRefreshError((e as Error).message);
    } finally {
      setLoaded(true);
    }
    // Keep the open request current too (e.g. resolved by another agent).
    if (selectedRef.current) loadDetail(selectedRef.current);
  }, [session, filter, handleErr, loadDetail]);

  // A new filter starts a fresh list; the bump discards any refresh still in flight for the old one.
  useEffect(() => {
    listSeq.current += 1;
    rowCount.current = 0;
    setRows([]);
    setNextCursor(null);
    setLoaded(false);
    setError(null);
  }, [filter]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const seq = ++listSeq.current;
    setLoadingMore(true);
    setError(null);
    try {
      const params = { ...(FILTERS.find((f) => f.key === filter)?.params ?? {}), limit: String(PAGE), cursor: nextCursor };
      const page = await api.listRequests(params);
      if (seq !== listSeq.current) return;
      setRows((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    selectedRef.current = selected;
    setDetail(null);
    if (!selected) return;
    loadDetail(selected);
    // Phones: the detail opens as a full-screen sheet, so move focus into it.
    // Tablets: the detail panel is stacked below the table, so bring it into view.
    if (window.matchMedia('(max-width: 640px)').matches) backRef.current?.focus();
    else if (window.matchMedia('(max-width: 1200px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected, loadDetail]);

  // Redirecting to /login (or the customer area) while the session loads.
  if (!session) return <div className="skeleton" style={{ height: 320 }} />;

  return (
    <div>
      {!stats && !loaded && (
        <div className="stats">
          {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="card stat skeleton" style={{ height: 70 }} />)}
        </div>
      )}
      {stats && (
        <div className="stats">
          <Stat k="Total requests" v={stats.total} />
          <Stat k="Auto-approved" v={stats.approved} color="var(--approved)" />
          <Stat k="Auto-denied" v={stats.denied} color="var(--denied)" />
          <Stat k="Needs review" v={stats.pending_review} color="var(--escalated)" />
          <Stat k="Security flagged" v={stats.security_flagged} color="var(--denied)" />
          <Stat k="Refunded" v={money(Number(stats.refunded_total))} />
        </div>
      )}

      <div className="row toolbar" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={`tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
              {stats && <span className="tab-count">{f.count(stats)}</span>}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn" onClick={refresh}>Refresh</button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {refreshError && (
        <div className="notice" role="status" style={{ marginBottom: 12 }}>
          Couldn&apos;t refresh the queue ({refreshError}). Retrying automatically.
        </div>
      )}

      <div className="admin-grid">
        <div className="card tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer / order</th>
                <th>Reason</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {!loaded &&
                [0, 1, 2, 3].map((k) => (
                  <tr key={k}>
                    <td colSpan={5}>
                      <div className="skeleton" style={{ height: 36 }} />
                    </td>
                  </tr>
                ))}
              {loaded && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: 24, textAlign: 'center' }}>
                    {filter === 'pending' ? 'Nothing is waiting for review.' : 'No refund requests match this filter.'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  data-id={r.id}
                  className={`clickable ${selected === r.id ? 'sel' : ''}`}
                  tabIndex={0}
                  aria-label={`Open request from ${r.customerName}, order ${r.orderId}, ${r.decision.toLowerCase()}`}
                  onClick={() => setSelected(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(r.id);
                    }
                  }}
                >
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.createdAt)}</td>
                  <td>
                    <div>{r.customerName}</div>
                    <div className="small muted mono">{r.orderId}</div>
                    <div className="small preview">{r.messagePreview}</div>
                  </td>
                  <td className="small">
                    {r.reasonCategory?.replace(/_/g, ' ') ?? '—'}
                    <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                      {r.securityFlagCount > 0 && <span className="badge badge-flag">⚑ {r.securityFlagCount} flag{r.securityFlagCount > 1 ? 's' : ''}</span>}
                      {r.aiMode === 'fallback' && <span className="badge badge-fallback">fallback</span>}
                    </div>
                  </td>
                  <td>
                    <RequestStatusBadge decision={r.decision} status={r.status} />
                    {r.status === 'pending_review' && <div className="small muted waiting">Waiting {fmtAge(r.createdAt)}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.refundAmount > 0 ? money(r.refundAmount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="load-more">
              <button className="btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>

        <div className={`card detail ${selected ? 'is-open' : 'is-empty'}`} ref={detailRef}>
          <div className="sheet-bar">
            <button
              ref={backRef}
              className="btn-back"
              onClick={() => {
                // Return focus to the row that opened the sheet, then close it.
                document.querySelector<HTMLElement>(`tr[data-id="${selected}"]`)?.focus();
                setSelected(null);
              }}
            >
              ‹ Requests
            </button>
          </div>
          {!selected ? (
            <div className="card-b muted">Select a request to see the AI assessment, the policy rules that applied, and the audit trail.</div>
          ) : !detail ? (
            <div className="card-b stack">
              {[28, 90, 140, 90].map((h, k) => <div key={k} className="skeleton" style={{ height: h }} />)}
            </div>
          ) : (
            <Detail
              d={detail}
              onResolved={(d) => {
                setDetail(d);
                refresh();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, color }: { k: string; v: number | string; color?: string }) {
  return (
    <div className="card stat">
      <div className="k">{k}</div>
      <div className="v" style={{ color }}>{v}</div>
    </div>
  );
}

function Detail({ d, onResolved }: { d: RequestDetail; onResolved: (d: RequestDetail) => void }) {
  const a = d.aiAssessment;
  const itemName = (id: string) => d.order?.items.find((i) => i.id === id)?.name ?? id;
  const triggered = d.ruleResults.filter((r) => r.outcome !== 'pass');
  const passed = d.ruleResults.filter((r) => r.outcome === 'pass');
  // Plain-language "why" at the top: the rules that caused an escalation or denial.
  const reasons = d.ruleResults.filter((r) => r.outcome === (d.decision === 'DENIED' ? 'deny' : 'escalate'));
  const whyTitle = d.status === 'pending_review' ? 'Why it needs review' : d.decision === 'DENIED' ? 'Why it was denied' : 'Why it was escalated';

  return (
    <>
      <div className="card-h" style={{ justifyContent: 'space-between' }}>
        <RequestStatusBadge decision={d.decision} status={d.status} />
        <span className="small muted mono">{d.id.slice(0, 8)}</span>
      </div>

      {reasons.length > 0 && (
        <div className={`section why why-${d.decision}`}>
          <h4>{whyTitle}</h4>
          <ul className="why-list">
            {reasons.map((r, i) => (
              <li key={i}>{r.detail}</li>
            ))}
          </ul>
          {a && <div className="small muted">Customer says: {a.summary}</div>}
        </div>
      )}

      <div className="section">
        <h4>Customer message</h4>
        <div className="quote">{d.customerMessage}</div>
      </div>

      {d.securityFlags.length > 0 && (
        <div className="section">
          <h4>Security flags</h4>
          <div className="stack" style={{ gap: 6 }}>
            {d.securityFlags.map((f, i) => (
              <div key={i} className="small">
                <span className="badge badge-flag">{f.code}</span> <span className="muted">({f.source})</span> {f.detail}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h4>Customer & order</h4>
        <dl className="kv">
          <dt>Customer</dt>
          <dd>
            {d.customer.name} <span className="muted">({d.customer.id}, {d.customer.tier})</span>
            {d.customer.riskFlag && <span className="badge badge-flag" style={{ marginLeft: 6 }}>risk flag</span>}
          </dd>
          <dt>Refunds (90d)</dt>
          <dd>{d.recentRefunds}</dd>
          <dt>Order</dt>
          <dd className="mono">{d.orderId} · {d.order?.status}</dd>
          <dt>Delivered</dt>
          <dd>{fmtDate(d.order?.deliveredAt ?? null)}{d.order?.signatureOnDelivery ? ' (signed for)' : ''}</dd>
          <dt>Items</dt>
          <dd>
            {d.order?.items.map((i) => (
              <div key={i.id} className="small">
                {i.name} · {money(i.unitPrice * i.quantity)}
                {i.finalSale && <span className="tag">FINAL SALE</span>}
                {i.refunded && <span className="tag tag-red">REFUNDED</span>}
              </div>
            ))}
          </dd>
          <dt>Refund amount</dt>
          <dd>
            <strong>{money(d.refundAmount)}</strong>
            {d.itemIds.length > 0 && <span className="muted small"> ({d.itemIds.map(itemName).join(', ')})</span>}
          </dd>
        </dl>
      </div>

      {d.status === 'pending_review' && <ResolveForm key={d.id} d={d} onResolved={onResolved} />}

      {d.resolvedAt && (
        <div className="section">
          <h4>Agent resolution</h4>
          <div className="small">
            <strong>{d.resolvedBy}</strong> · {fmtTime(d.resolvedAt)}
          </div>
          <div className="quote" style={{ marginTop: 6 }}>{d.resolutionNote}</div>
        </div>
      )}

      {a && (
        <div className="section">
          <h4>
            AI assessment{' '}
            <span className={`badge ${d.aiMode === 'llm' ? 'badge-llm' : 'badge-fallback'}`} style={{ textTransform: 'none', letterSpacing: 0 }}>
              {d.aiMode === 'llm' ? d.aiModel : 'keyword fallback'}
            </span>
          </h4>
          <dl className="kv">
            <dt>Reason</dt>
            <dd>{a.reasonCategory.replace(/_/g, ' ')} <span className="muted">({Math.round(a.confidence * 100)}% confidence)</span></dd>
            <dt>Summary</dt>
            <dd>{a.summary}</dd>
            <dt>Items named</dt>
            <dd>{a.claimedItemIds.length ? a.claimedItemIds.map(itemName).join(', ') : <span className="muted">none (whole order)</span>}</dd>
            {a.customerRequestedAmount !== null && (
              <>
                <dt>Amount asked</dt>
                <dd>{money(a.customerRequestedAmount)}</dd>
              </>
            )}
            {a.inconsistencies.length > 0 && (
              <>
                <dt>Inconsistencies</dt>
                <dd>{a.inconsistencies.map((x, i) => <div key={i}>• {x}</div>)}</dd>
              </>
            )}
            {a.manipulationAttempt && (
              <>
                <dt>Manipulation</dt>
                <dd style={{ color: 'var(--denied)' }}>{a.manipulationEvidence ?? 'Flagged'}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      <div className="section">
        <h4>Policy rules applied (v{d.policyVersion})</h4>
        {triggered.map((r, i) => (
          <div key={i} className="rule">
            <span className="mono">{r.ruleId}</span>
            <span className={`out-${r.outcome}`}>{r.outcome}</span>
            <span>{r.detail}</span>
          </div>
        ))}
        {passed.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary>{passed.length} passed check{passed.length > 1 ? 's' : ''}</summary>
            {passed.map((r, i) => (
              <div key={i} className="rule">
                <span className="mono">{r.ruleId}</span>
                <span className="out-pass">pass</span>
                <span>{r.detail}</span>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="section">
        <h4>Reply sent to customer</h4>
        <div className="quote">{d.customerReply}</div>
      </div>

      <div className="section">
        <h4>Audit trail {d.latencyMs !== null && <span className="muted" style={{ textTransform: 'none' }}>· processed in {d.latencyMs} ms</span>}</h4>
        <ul className="timeline">
          {d.auditTrail.map((e, i) => (
            <li key={i}>
              <div className="small">
                <strong>{EVENT_LABEL[e.eventType] ?? e.eventType}</strong> <span className="muted">· {e.actor}</span>
              </div>
              <div className="small muted">{fmtTime(e.createdAt)}</div>
              <details>
                <summary>details</summary>
                <pre className="json">{JSON.stringify(e.detail, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ResolveForm({ d, onResolved }: { d: RequestDetail; onResolved: (d: RequestDetail) => void }) {
  const [note, setNote] = useState('');
  const refundable = d.order?.items.filter((i) => !i.refunded) ?? [];
  const [itemIds, setItemIds] = useState<string[]>(() => d.itemIds.filter((id) => refundable.some((i) => i.id === id)));
  // Whole items only: the refund is exactly the selected items' value (summed in cents, as the server does).
  const selectedCents = refundable.filter((i) => itemIds.includes(i.id)).reduce((s, i) => s + Math.round(i.unitPrice * 100) * i.quantity, 0);
  const selectedValue = selectedCents / 100;
  const toggle = (id: string) => {
    setConfirming(null);
    setItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'approve' | 'deny' | null>(null);

  /** Step 1: validate, then ask for confirmation. Resolving moves money and can't be undone. */
  function review(action: 'approve' | 'deny') {
    setErr(null);
    if (note.trim().length < 3) {
      setErr('Add a note for the audit trail.');
      return;
    }
    if (action === 'approve') {
      if (itemIds.length === 0) return setErr('Select at least one item to refund.');
    }
    setConfirming(action);
  }

  /** Step 2: send. */
  async function act(action: 'approve' | 'deny') {
    setErr(null);
    setBusy(true);
    try {
      const body: ResolveBody = { action, note: note.trim() };
      if (action === 'approve') body.itemIds = itemIds;
      onResolved(await api.resolve(d.id, body));
    } catch (e) {
      setErr((e as Error).message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section" style={{ background: 'var(--escalated-soft)' }}>
      <h4 style={{ color: 'var(--escalated)' }}>Needs a human decision</h4>
      <div className="stack" style={{ gap: 8 }}>
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        <fieldset className="item-picker">
          <legend className="label">Items to refund if approved</legend>
          {refundable.length === 0 && <div className="small muted">Every item in this order has already been refunded.</div>}
          {refundable.map((i) => (
            <label key={i.id} className="small row" style={{ gap: 6 }}>
              <input type="checkbox" checked={itemIds.includes(i.id)} onChange={() => toggle(i.id)} />
              {i.name} · {money(i.unitPrice * i.quantity)}
              {i.finalSale && <span className="tag">FINAL SALE</span>}
            </label>
          ))}
        </fieldset>
        <div className="small">
          Refund total: <strong>{money(selectedValue)}</strong> <span className="muted">(full value of the selected items)</span>
        </div>
        <div className="field">
          <label className="label" htmlFor={`note-${d.id}`}>
            Resolution note
          </label>
          <textarea
            id={`note-${d.id}`}
            className="textarea"
            aria-describedby={`note-hint-${d.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div id={`note-hint-${d.id}`} className="small muted">
            Saved in the audit trail and shown to the customer.
          </div>
        </div>
        {!confirming ? (
          <div className="row">
            <button className="btn btn-approve" disabled={busy} onClick={() => review('approve')}>Approve refund…</button>
            <button className="btn btn-deny" disabled={busy} onClick={() => review('deny')}>Deny…</button>
          </div>
        ) : (
          <div className="confirm" role="group" aria-label="Confirm resolution">
            <div className="small">
              {confirming === 'approve'
                ? `Refund ${money(selectedValue)} for ${itemIds.length} item${itemIds.length > 1 ? 's' : ''}? The customer is notified and this can't be undone.`
                : "Deny this request? The customer is notified and this can't be undone."}
            </div>
            <div className="row">
              <button className={`btn ${confirming === 'approve' ? 'btn-approve' : 'btn-deny'}`} disabled={busy} autoFocus onClick={() => act(confirming)}>
                {busy ? 'Saving…' : confirming === 'approve' ? 'Confirm refund' : 'Confirm denial'}
              </button>
              <button className="btn" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
