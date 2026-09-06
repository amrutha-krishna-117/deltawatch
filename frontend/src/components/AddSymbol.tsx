import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import type { SearchResult } from '../types';

export function AddSymbol() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchSymbols = useStore((s) => s.searchSymbols);
  const addSymbol = useStore((s) => s.addSymbol);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      const res = await searchSymbols(q);
      setResults(res);
      setSearching(false);
    }, 280);
  }, [searchSymbols]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setSelected(null);
    setError(null);
    doSearch(v);
  }

  function handleSelect(r: SearchResult) {
    setSelected(r);
    setQuery(r.symbol);
    setResults([]);
    inputRef.current?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = (selected?.symbol ?? query).trim().toUpperCase();
    if (!sym) return;
    setError(null);
    setLoading(true);
    const result = await addSymbol(sym, selected?.name);
    setLoading(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setQuery(''); setSelected(null); setResults([]); setOpen(false);
    }
  }

  // Close on outside click or Escape
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
        style={{ background: 'rgba(129,140,248,0.1)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.2)' }}
        onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.18)'; }}
        onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.1)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 2v12M2 8h12" />
        </svg>
        Add stock
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="w-full">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: 'var(--card)', border: '1px solid rgba(129,140,248,0.35)' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#818cf8" strokeWidth="2" className="flex-none">
              <circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={handleChange}
              placeholder="Search symbol or company… e.g. NVDA, TCS.NS, Apple"
              disabled={loading}
              className="flex-1 bg-transparent text-sm outline-none placeholder-[#475569]"
              style={{ color: 'var(--text)' }}
              autoComplete="off"
            />
            {searching && (
              <svg className="animate-spin flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>
              </svg>
            )}
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-3 py-1 rounded-lg text-xs font-semibold transition-all flex-none"
              style={{ background: '#818cf8', color: '#fff', opacity: (!query.trim() || loading) ? 0.4 : 1 }}
            >
              {loading ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setQuery(''); setResults([]); setError(null); }}
              className="flex-none"
              style={{ color: 'var(--text-dim)' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8"/>
              </svg>
            </button>
          </div>

          {/* Dropdown */}
          {results.length > 0 && (
            <ul
              className="absolute top-full mt-1.5 w-full rounded-xl overflow-hidden z-50 shadow-xl"
              style={{ background: '#1a2133', border: '1px solid var(--border)' }}
            >
              {results.slice(0, 7).map((r) => (
                <li key={r.symbol}>
                  <button
                    type="button"
                    onClick={() => handleSelect(r)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-4 transition-colors"
                    style={{ color: 'var(--text)' }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.08)'; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span className="flex items-center gap-3">
                      <span className="font-semibold text-sm min-w-[80px]">{r.symbol}</span>
                      <span style={{ color: 'var(--text-dim)' }} className="truncate">{r.name}</span>
                    </span>
                    <span
                      className="text-[10px] font-medium flex-none px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(71,85,105,0.4)', color: '#94a3b8' }}
                    >
                      {r.exchange || r.type}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p className="mt-2 text-xs flex items-center gap-1.5" style={{ color: '#f87171' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="8" r="6"/><path d="M8 5v4M8 11v1"/>
            </svg>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
