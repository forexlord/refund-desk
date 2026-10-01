// Typed client for the Refund Desk API (via the same-origin /api proxy).
// Auth is the httpOnly session cookie set at sign-in; the browser sends it automatically on same-origin requests,
// so page scripts never hold the token.

export type Decision = 'APPROVED' | 'DENIED' | 'ESCALATED';
export type Status = 'closed' | 'pending_review' | 'resolved_approved' | 'resolved_denied';

export type SessionInfo =
  | { role: 'customer'; id: string; name: string; email: string; tier: string }
  | { role: 'agent'; id: string; name: string; email: string };
export interface SignedIn { status: 'signed_in'; token: string; tokenType: 'Bearer'; expiresAt: string; user: SessionInfo }
/** DEMO ONLY: synthetic accounts for the sign-in pickers (404 when DEMO_ACCOUNTS is off). */
export interface DemoAccount { name: string; email: string; detail: string; password: string }
/** Agents only: the password was right, now a one-time code is needed. `demoOtp` is present only in demo mode. */
export interface OtpRequired { status: 'otp_required'; challengeId: string; expiresAt: string; demoOtp?: string }
export interface OrderItem { id: string; name: string; unitPrice: number; quantity: number; finalSale: boolean; refunded: boolean }
export interface Order {
  id: string; status: string; placedAt: string; expectedDelivery: string | null; deliveredAt: string | null; total: number; items: OrderItem[];
}
export interface CustomerRequest {
  id: string; orderId: string; decision: Decision; status: Status; refundAmount: number; itemIds: string[];
  customerMessage: string; customerReply: string; createdAt: string; resolvedAt: string | null; resolutionNote: string | null;
}
export interface RefundResponse {
  requestId: string; orderId: string; decision: Decision; status: Status; refundAmount: number; itemIds: string[]; reply: string; createdAt: string;
}
export interface RequestRow {
  id: string; customerId: string; customerName: string; orderId: string; decision: Decision; status: Status; refundAmount: number;
  reasonCategory: string | null; aiMode: 'llm' | 'fallback'; securityFlagCount: number; messagePreview: string; createdAt: string; resolvedAt: string | null;
}
export interface RuleResult { ruleId: string; outcome: 'pass' | 'deny' | 'escalate' | 'info'; detail: string; customerReason?: string; itemIds?: string[] }
export interface SecurityFlag { source: string; code: string; detail: string }
export interface AuditEvent { eventType: string; actor: string; detail: Record<string, unknown>; createdAt: string }
export interface RequestDetail {
  id: string;
  customer: { id: string; name: string; email: string; tier: string; riskFlag: boolean };
  orderId: string; customerMessage: string; decision: Decision; status: Status; refundAmount: number; itemIds: string[];
  reasonCategory: string | null; customerReply: string;
  aiAssessment: {
    reasonCategory: string; claimedItemIds: string[]; mentionsItemsNotInOrder: boolean; customerRequestedAmount: number | null;
    summary: string; confidence: number; manipulationAttempt: boolean; manipulationEvidence: string | null; inconsistencies: string[];
  } | null;
  ruleResults: RuleResult[]; securityFlags: SecurityFlag[]; aiMode: 'llm' | 'fallback'; aiModel: string | null; policyVersion: string;
  latencyMs: number | null; createdAt: string; resolvedAt: string | null; resolvedBy: string | null; resolutionNote: string | null;
  auditTrail: AuditEvent[]; order: Order & { signatureOnDelivery: boolean }; recentRefunds: number;
}
export interface Stats {
  total: number; approved: number; denied: number; escalated: number; pending_review: number;
  security_flagged: number; refunded_total: number; fallback_count: number;
}

/** One page of a keyset-paginated list; pass `nextCursor` back for the next page (null = no more). */
export interface Page<T> { items: T[]; nextCursor: string | null }

export interface Health { status: string; aiMode: 'llm' | 'degraded' | 'fallback'; aiError: string | null; model: string | null }
/** Approving refunds the full value of whole items; there is no amount override. */
export interface ResolveBody { action: 'approve' | 'deny'; note: string; itemIds?: string[] }

/** status 0 = the request never reached the server (offline, DNS, CORS). */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
  /** The service is unreachable or down, as opposed to rejecting the request. */
  get unavailable() { return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504; }
}

/** Where a signed-out user of the current area should sign in. */
export const signInPathFor = (pathname: string) => (pathname.startsWith('/admin') ? '/staff/login' : '/login');

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, { ...init, headers: { 'content-type': 'application/json' }, cache: 'no-store' });
  } catch {
    throw new ApiError(0, "Can't reach Refund Desk. Check your connection and try again.");
  }
  // An expired or revoked session outside the auth endpoints sends the user back to sign in, saying why.
  if (res.status === 401 && !path.startsWith('auth/')) window.location.assign(`${signInPathFor(window.location.pathname)}?expired=1`);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page, e.g. from a proxy */
  }
  if (!res.ok) {
    const fallback = res.status >= 502 && res.status <= 504 ? 'Refund Desk is temporarily unavailable. Please try again shortly.' : `Request failed (${res.status})`;
    const msg = Array.isArray(body?.message) ? body.message.join('; ') : body?.message ?? fallback;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

export const api = {
  demoAccounts: () => request<{ customers: DemoAccount[]; agents: DemoAccount[] }>('auth/demo-accounts'),
  login: (email: string, password: string) =>
    request<SignedIn | OtpRequired>('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  verifyOtp: (challengeId: string, code: string) =>
    request<SignedIn>('auth/verify-otp', { method: 'POST', body: JSON.stringify({ challengeId, code }) }),
  logout: () => request<null>('auth/logout', { method: 'POST' }),
  me: () => request<SessionInfo>('auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SignedIn>('auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  requestReset: (email: string) => request<{ message: string }>('auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }),
  confirmReset: (token: string, newPassword: string) =>
    request<null>('auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
  myOrders: () => request<Order[]>('me/orders'),
  myRequests: (orderId: string, opts: { limit: number; before?: string }) => {
    const qs = new URLSearchParams({ orderId, limit: String(opts.limit), ...(opts.before ? { before: opts.before } : {}) });
    return request<Page<CustomerRequest>>(`me/refund-requests?${qs}`);
  },
  submitRefund: (orderId: string, message: string) =>
    request<RefundResponse>('refund-requests', { method: 'POST', body: JSON.stringify({ orderId, message }) }),
  health: () => request<Health>('health'),
  policy: () => request<{ version: string; markdown: string }>('policy'),
  stats: () => request<Stats>('admin/stats'),
  listRequests: (params: Record<string, string>) => request<Page<RequestRow>>(`admin/refund-requests?${new URLSearchParams(params)}`),
  requestDetail: (id: string) => request<RequestDetail>(`admin/refund-requests/${id}`),
  resolve: (id: string, body: ResolveBody) =>
    request<RequestDetail>(`admin/refund-requests/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),
};

export const money = (n: number) => `$${n.toFixed(2)}`;
export const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtTime = (s: string) => new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
