'use client';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '@/lib/api';

export default function PolicyPage() {
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.policy().then((p) => setMd(p.markdown)).catch((e) => setErr(e.message));
  }, []);
  return (
    <div className="card policy" style={{ margin: '0 auto' }}>
      <div className="card-b">
        {err && <div className="error">{err}</div>}
        {md ? <ReactMarkdown>{md}</ReactMarkdown> : !err && <div className="muted">Loading…</div>}
      </div>
    </div>
  );
}
