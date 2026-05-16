'use client';

import { useEffect, useState, useMemo } from 'react';

/* ── Types ── */
interface Tender {
  name: string;
  org: string;
  amount: string;
  openDate: string;
  closeDate: string;
  addedOn: string;
  location: string;
}

interface TenderData {
  lastFetched: string | null;
  location: string;
  totalActive: number;
  tenders: Tender[];
}

type Tab = 'all' | 'fresh' | 'closing';

/* ── Maintenance filter ── */
const MAINTENANCE_KW = [
  'maintenance', 'repair', 'renovation', 'annual', 'amc', 'servicing',
  'upkeep', 'overhaul', 'restoring', 'restoration', 'refurbishment',
  'whitewash', 'painting', 'repairing',
];

function isMaintenance(name: string): boolean {
  const l = name.toLowerCase();
  return MAINTENANCE_KW.some(kw => l.includes(kw));
}

/* ── Formatters ── */
function fmtAmount(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(v as string);
  if (!v || isNaN(n) || n === 0) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDay(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short' });
}

function fmtLastFetched(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

function daysLeft(closeDate: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(closeDate).getTime() - today.getTime()) / 86_400_000);
}

function cleanName(name: string): string {
  return name.replace(/\]\s*\[[^\]]+\](\s*\[[^\]]+\])*\s*$/, '').replace(/^\[/, '').trim();
}

function sumValue(list: Tender[]): string {
  const s = list.reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0);
  return fmtAmount(s);
}

/* ── Urgency ── */
type Urgency = 'critical' | 'warning' | 'fresh' | 'normal';

function getUrgency(days: number, isNew: boolean): Urgency {
  if (days <= 2) return 'critical';
  if (days <= 7) return 'warning';
  if (isNew) return 'fresh';
  return 'normal';
}

const U: Record<Urgency, { border: string; pill: string; pillBg: string; text: string; label: (d: number) => string }> = {
  critical: { border: '#7f1d1d', pill: '#f87171', pillBg: '#f8717120', text: '#f87171', label: d => `${d}d — act now` },
  warning:  { border: '#78350f', pill: '#fbbf24', pillBg: '#fbbf2420', text: '#fbbf24', label: d => `Closes in ${d}d` },
  fresh:    { border: '#14532d', pill: '#4ade80', pillBg: '#4ade8020', text: '#4ade80', label: () => 'Fresh today' },
  normal:   { border: '#252525', pill: '#3b82f6', pillBg: '#3b82f620', text: '#3b82f6', label: () => 'Open' },
};

/* ── Sub-components ── */
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 170, borderRadius: 12 }} />
      ))}
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingBottom: 11 }}>
      <span style={{ fontSize: 11, color: '#4a4a4a', flexShrink: 0, lineHeight: 1.5 }}>{label}</span>
      <span style={{ fontSize: 13, color: color ?? '#bbb', textAlign: 'right', lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function TenderCard({ tender, today, onRemove }: { tender: Tender; today: string; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const days = daysLeft(tender.closeDate);
  const isNew = tender.addedOn === today;
  const u = U[getUrgency(days, isNew)];
  const name = tender.name.trim();
  const closeDateColor = days <= 2 ? '#f87171' : days <= 7 ? '#fbbf24' : '#bbb';

  return (
    <div style={{
      background: '#141414',
      borderTop: `1px solid ${u.border}`,
      borderRight: `1px solid ${u.border}`,
      borderBottom: `1px solid ${u.border}`,
      borderLeft: `3px solid ${u.border}`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Tappable collapsed region */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '14px 16px', cursor: 'pointer', userSelect: 'none' as const }}
      >
        {/* Row 1: amount + urgency pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {fmtAmount(tender.amount)}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap',
            color: u.pill, background: u.pillBg, padding: '3px 10px', borderRadius: 20,
          }}>
            {u.label(days)}
          </span>
        </div>

        {/* Row 2: name */}
        <p style={{ fontSize: 14, color: '#bbb', lineHeight: 1.5, marginBottom: 12 }}>
          {name}
        </p>

        {/* Row 3: date boxes */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 8, padding: '8px 10px', border: '1px solid #222' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4a4a4a', letterSpacing: '0.08em', marginBottom: 3 }}>BID OPENS</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{fmtDate(tender.openDate)}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{fmtDay(tender.openDate)}</div>
          </div>
          <div style={{
            flex: 1, background: '#1a1a1a', borderRadius: 8, padding: '8px 10px',
            border: `1px solid ${days <= 7 ? u.border : '#222'}`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4a4a4a', letterSpacing: '0.08em', marginBottom: 3 }}>BID CLOSES</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: closeDateColor }}>{fmtDate(tender.closeDate)}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{fmtDay(tender.closeDate)}</div>
          </div>
        </div>

        {/* Footer row: countdown + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: u.text }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{days <= 0 ? 'Closed' : `${days} day${days !== 1 ? 's' : ''} remaining`}</span>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.2"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 240ms ease', flexShrink: 0 }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Expanded panel */}
      {open && (
        <div style={{ borderTop: '1px solid #222', padding: '14px 16px', background: '#161616' }}>
          <DetailRow label="Organisation" value={tender.org || '—'} />
          <DetailRow label="Tender Value" value={fmtAmount(tender.amount)} color="#3b82f6" />
          <DetailRow label="Bid Opens" value={`${fmtDay(tender.openDate)}, ${fmtDate(tender.openDate)}`} />
          <DetailRow label="Bid Closes" value={`${fmtDay(tender.closeDate)}, ${fmtDate(tender.closeDate)}`} color={closeDateColor} />
          <DetailRow label="Days Left" value={days <= 0 ? 'Closed' : `${days} day${days !== 1 ? 's' : ''}`} color={u.text} />
          <DetailRow label="Added On" value={fmtDate(tender.addedOn)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              onClick={e => { e.stopPropagation(); onRemove(); }}
              style={{
                background: '#f8717112', border: '1px solid #f8717130',
                color: '#f87171', borderRadius: 8, fontSize: 12,
                fontWeight: 600, padding: '7px 16px', cursor: 'pointer',
                fontFamily: 'inherit', minHeight: 36,
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Add Modal (bottom sheet) ── */
interface AddForm { name: string; org: string; amount: string; openDate: string; closeDate: string }
const EMPTY: AddForm = { name: '', org: '', amount: '', openDate: '', closeDate: '' };

function AddModal({ today, onClose, onAdd }: { today: string; onClose: () => void; onAdd: (t: Tender) => void }) {
  const [form, setForm] = useState<AddForm>(EMPTY);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isMaintenance(form.name)) {
      alert('This looks like a maintenance tender and will be filtered out');
      return;
    }
    onAdd({ name: form.name, org: form.org, amount: form.amount, openDate: form.openDate, closeDate: form.closeDate, addedOn: today, location: 'Noida' });
    onClose();
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: '#1a1a1a',
    border: '1px solid #252525', borderRadius: 8, color: '#fff',
    fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#555', fontWeight: 600, letterSpacing: '0.07em', marginBottom: 6 };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000000b0', zIndex: 40, backdropFilter: 'blur(3px)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: '#161616', borderRadius: '20px 20px 0 0',
        padding: '0 20px 40px', maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 -12px 48px #000000dd',
      }}>
        <div style={{ width: 36, height: 4, background: '#333', borderRadius: 2, margin: '14px auto 20px' }} />
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Add Tender</h2>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>TENDER NAME *</label>
            <textarea value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required rows={2} placeholder="Enter tender title…"
              style={{ ...inp, resize: 'vertical' as const }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>ORGANISATION</label>
            <input value={form.org} onChange={e => setForm(f => ({ ...f, org: e.target.value }))}
              placeholder="Issuing organisation" style={inp} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>AMOUNT (₹)</label>
            <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              type="number" placeholder="0" style={inp} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>BID OPENS *</label>
              <input value={form.openDate} onChange={e => setForm(f => ({ ...f, openDate: e.target.value }))}
                type="date" required style={{ ...inp, colorScheme: 'dark' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>BID CLOSES *</label>
              <input value={form.closeDate} onChange={e => setForm(f => ({ ...f, closeDate: e.target.value }))}
                type="date" required style={{ ...inp, colorScheme: 'dark' }} />
            </div>
          </div>
          <button type="submit" style={{
            width: '100%', padding: '14px', borderRadius: 12,
            background: '#3b82f6', border: 'none', color: '#fff',
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
            minHeight: 50, fontFamily: 'inherit',
          }}>
            Add Tender
          </button>
        </form>
      </div>
    </>
  );
}

/* ── Main dashboard ── */
export default function TenderDashboard() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [scraping, setScraping] = useState<'idle' | 'pending' | 'queued' | 'error'>('idle');

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  async function load() {
    setLoading(true); setError(false);
    try {
      const res = await fetch('/api/tenders');
      if (!res.ok) throw new Error();
      const json: TenderData = await res.json();
      const kept = json.tenders.filter(t => {
        if (t.closeDate < today) return false;
        if (isMaintenance(t.name)) { console.log(`Skipped (maintenance): ${t.name}`); return false; }
        return true;
      });
      setTenders(kept);
      setLastFetched(json.lastFetched);
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function triggerScrape() {
    setScraping('pending');
    try {
      const res = await fetch('/api/trigger', { method: 'POST' });
      if (res.ok) {
        setScraping('queued');
        setTimeout(() => setScraping('idle'), 8000);
      } else {
        setScraping('error');
        setTimeout(() => setScraping('idle'), 4000);
      }
    } catch {
      setScraping('error');
      setTimeout(() => setScraping('idle'), 4000);
    }
  }

  const fresh   = useMemo(() => tenders.filter(t => t.addedOn === today), [tenders, today]);
  const closing = useMemo(() =>
    tenders.filter(t => daysLeft(t.closeDate) <= 7).sort((a, b) => a.closeDate.localeCompare(b.closeDate)),
  [tenders]);

  const displayed = useMemo(() => {
    const base = tab === 'fresh' ? fresh : tab === 'closing' ? closing : tenders;
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(t => t.name.toLowerCase().includes(q) || t.org.toLowerCase().includes(q));
  }, [tab, tenders, fresh, closing, search]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all',     label: 'All',     count: tenders.length },
    { key: 'fresh',   label: 'Fresh',   count: fresh.length },
    { key: 'closing', label: 'Closing', count: closing.length },
  ];

  const stats: { label: string; value: string | number }[] = [
    { label: 'Total Active',   value: tenders.length },
    { label: 'Closing ≤7d',   value: closing.length },
    { label: 'Fresh Today',    value: fresh.length },
    { label: 'Total Value',    value: sumValue(tenders) },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', paddingBottom: 88 }}>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 16px' }}>

        {/* ── Header ── */}
        <div style={{ padding: '20px 0 16px', borderBottom: '1px solid #1a1a1a', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 7px #22c55e', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, letterSpacing: '0.09em' }}>LIVE</span>
              <h1 style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>
                Noida Tender Tracker
              </h1>
            </div>
            <button
              onClick={triggerScrape}
              disabled={scraping === 'pending'}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1px solid #252525',
                background: scraping === 'queued' ? '#14532d' : scraping === 'error' ? '#7f1d1d' : '#1a1a1a',
                color: scraping === 'queued' ? '#4ade80' : scraping === 'error' ? '#f87171' : '#bbb',
                fontSize: 11, fontWeight: 600, cursor: scraping === 'pending' ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap', minHeight: 32,
                opacity: scraping === 'pending' ? 0.6 : 1,
                transition: 'all 200ms',
              }}
            >
              {scraping === 'pending' ? '⟳ Scraping…' : scraping === 'queued' ? '✓ Queued ~5 min' : scraping === 'error' ? '✗ Failed' : '⟳ Scrape Now'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#4a4a4a', paddingLeft: 16, marginTop: 4 }}>
            UP NIC eProcurement · scraped daily at 11:00 AM IST
          </p>
        </div>

        {/* ── Stats bar (2×2) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {stats.map(s => (
            <div key={s.label} style={{
              background: '#141414', border: '1px solid #1e1e1e',
              borderRadius: 10, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: '0.08em', marginBottom: 5 }}>
                {s.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Search ── */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tenders…"
          style={{
            width: '100%', padding: '10px 14px', boxSizing: 'border-box',
            background: '#1a1a1a', border: '1px solid #252525',
            borderRadius: 10, color: '#fff', fontSize: 13,
            outline: 'none', fontFamily: 'inherit', marginBottom: 0,
          }}
        />

        {/* ── Tabs ── */}
        <div style={{
          display: 'flex', borderBottom: '1px solid #1a1a1a',
          marginBottom: 16, marginTop: 12, overflowX: 'auto',
        }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px', border: 'none', background: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: 600, minHeight: 44,
                color: tab === t.key ? '#fff' : '#555',
                borderBottom: `2px solid ${tab === t.key ? '#3b82f6' : 'transparent'}`,
                marginBottom: -1,
                display: 'flex', alignItems: 'center', gap: 7,
                transition: 'color 150ms',
              }}
            >
              {t.label}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                color: tab === t.key ? '#3b82f6' : '#444',
                background: tab === t.key ? '#3b82f618' : '#1a1a1a',
              }}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── States ── */}
        {loading && <Skeleton />}

        {error && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <p style={{ color: '#555', fontSize: 13, marginBottom: 20 }}>Could not load tender data</p>
            <button onClick={load} style={{
              background: '#3b82f6', border: 'none', borderRadius: 10, color: '#fff',
              fontSize: 13, fontWeight: 600, padding: '10px 28px',
              cursor: 'pointer', minHeight: 44, fontFamily: 'inherit',
            }}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && displayed.length === 0 && (
          <p style={{ textAlign: 'center', padding: '60px 0', color: '#4a4a4a', fontSize: 13 }}>
            {tab === 'fresh'   ? 'No new tenders added today.' :
             tab === 'closing' ? 'No tenders closing within 7 days.' :
             'No tenders match your search.'}
          </p>
        )}

        {/* ── Cards ── */}
        {!loading && !error && displayed.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayed.map((t, i) => (
              <TenderCard
                key={`${t.closeDate}-${i}`}
                tender={t}
                today={today}
                onRemove={() => setTenders(prev => prev.filter(x => x !== t))}
              />
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        {!loading && !error && (
          <p style={{ textAlign: 'center', fontSize: 11, color: '#333', marginTop: 32 }}>
            {displayed.length} of {tenders.length} tenders
            {lastFetched ? ` · Last fetched: ${fmtLastFetched(lastFetched)}` : ''}
          </p>
        )}
      </div>

      {/* ── FAB ── */}
      <button
        onClick={() => setShowAdd(true)}
        style={{
          position: 'fixed', bottom: 24, right: 20, zIndex: 30,
          width: 52, height: 52, borderRadius: '50%',
          background: '#3b82f6', border: 'none', color: '#fff',
          fontSize: 24, fontWeight: 300, cursor: 'pointer',
          boxShadow: '0 4px 24px #3b82f655',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        +
      </button>

      {showAdd && <AddModal today={today} onClose={() => setShowAdd(false)} onAdd={t => setTenders(prev => [t, ...prev])} />}
    </div>
  );
}
