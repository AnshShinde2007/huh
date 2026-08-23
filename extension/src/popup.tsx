/// <reference types="chrome" />
// src/popup.tsx
import { useState, useEffect } from 'react';

// ── Provider config ──────────────────────────────────────────────────────────

type ProviderId = 'claude' | 'chatgpt' | 'grok' | 'groq' | 'openrouter' | 'gemini';

const PROVIDERS: { id: ProviderId; label: string; placeholder: string }[] = [
  { id: 'claude',      label: 'Claude',      placeholder: 'sk-ant-…' },
  { id: 'chatgpt',     label: 'ChatGPT',     placeholder: 'sk-…' },
  { id: 'grok',        label: 'Grok',        placeholder: 'xai-…' },
  { id: 'groq',        label: 'Groq',        placeholder: 'gsk_…' },
  { id: 'openrouter',  label: 'OpenRouter',  placeholder: 'sk-or-…' },
  { id: 'gemini',      label: 'Gemini',      placeholder: 'AIzaSy…' },
];

// Maps our provider id → background.ts provider id + sensible default model
const PROVIDER_BRIDGE: Record<ProviderId, { bgId: string; model: string }> = {
  claude:     { bgId: 'anthropic',   model: 'claude-3-5-haiku-latest' },
  chatgpt:    { bgId: 'openai',      model: 'gpt-4o-mini' },
  grok:       { bgId: 'openrouter',  model: 'grok-4.5' },
  groq:       { bgId: 'groq',        model: 'openai/gpt-oss-120b' },
  openrouter: { bgId: 'openrouter',  model: 'google/gemini-2.5-flash' },
  gemini:     { bgId: 'gemini',      model: 'gemini-2.0-flash' },
};

// ── Main Popup ───────────────────────────────────────────────────────────────

export default function Popup() {
  const [tab, setTab] = useState<'dashboard' | 'byok'>('byok');

  // Auth link state
  const [isLinked, setIsLinked] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  // BYOK state
  const [provider, setProvider] = useState<ProviderId>('claude');
  const [apiKey, setApiKey]     = useState('');
  const [keysMap, setKeysMap]   = useState<Record<string, string>>({});
  const [showKey, setShowKey]   = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [byokStatus, setByokStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Interaction toggles (persisted, accessible from BYOK tab footer)
  const [showTrigger, setShowTrigger]         = useState(true);
  const [enableAltClick, setEnableAltClick]   = useState(true);
  const [cardPositionSetting, setCardPositionSetting] = useState<'selection' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('selection');
  const [showToggles, setShowToggles]         = useState(false);

  // ── Load saved local state on mount ──────────────────────────────────────
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(
      ['provider', 'apiKey', 'apiKeysMap', 'showTrigger', 'enableAltClick', 'cardPositionSetting', 'lookupCache', 'authToken'],
      (result) => {
        let currentProv: ProviderId = 'claude';
        if (result.provider) {
          const found = Object.entries(PROVIDER_BRIDGE).find(
            ([, v]) => v.bgId === result.provider
          );
          if (found) currentProv = found[0] as ProviderId;
        }
        setProvider(currentProv);

        const loadedMap: Record<string, string> = result.apiKeysMap || {};
        if (result.apiKey && !loadedMap[currentProv]) {
          loadedMap[currentProv] = result.apiKey;
        }
        setKeysMap(loadedMap);
        setApiKey(loadedMap[currentProv] || result.apiKey || '');

        if (result.showTrigger !== undefined) setShowTrigger(result.showTrigger);
        if (result.enableAltClick !== undefined) setEnableAltClick(result.enableAltClick);
        if (result.cardPositionSetting !== undefined) setCardPositionSetting(result.cardPositionSetting);
        if (Array.isArray(result.lookupCache)) setCacheSize(result.lookupCache.length);

        if (result.authToken) {
          setIsLinked(true);
          setSyncStatus('synced');
        }

        // If an API key is already saved, show dashboard
        if (result.apiKey || Object.keys(loadedMap).length > 0) {
          setTab('dashboard');
        }
      }
    );
  }, []);

  const handleProviderChange = (newProvider: ProviderId) => {
    setProvider(newProvider);
    const keyForProvider = keysMap[newProvider] || '';
    setApiKey(keyForProvider);
    setByokStatus(null);

    if (keyForProvider && typeof chrome !== 'undefined' && chrome.storage?.local) {
      const bridge = PROVIDER_BRIDGE[newProvider];
      chrome.storage.local.set({
        provider: bridge.bgId,
        model: bridge.model,
        apiKey: keyForProvider
      });
    }
  };

  // ── BYOK save ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setByokStatus({ ok: false, msg: 'API key cannot be empty.' });
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const bridge = PROVIDER_BRIDGE[provider];
    const updatedMap = { ...keysMap, [provider]: trimmed };
    setKeysMap(updatedMap);

    const settingsToSave = {
      provider: bridge.bgId,
      apiKey: trimmed,
      model: bridge.model,
      apiKeysMap: updatedMap,
      showTrigger,
      enableAltClick,
      cardPositionSetting,
    };

    // 1. Save locally
    await new Promise<void>((res) => chrome.storage.local.set(settingsToSave, res));

    // Note: If linked, we'd ideally sync to Firestore here, but since auth is now
    // externalized, we only store locally. The landing page could be opened to sync.

    const provLabel = PROVIDERS.find(p => p.id === provider)?.label || provider;
    setByokStatus({ ok: true, msg: `Key saved for ${provLabel}!` });
    setTimeout(() => {
      setByokStatus(null);
      setTab('dashboard');
    }, 1000);
  };

  const handleClearCache = () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.set({ lookupCache: [] }, () => {
      setCacheSize(0);
      setByokStatus({ ok: true, msg: 'Cache cleared.' });
      setTimeout(() => setByokStatus(null), 2000);
    });
  };

  const handleSignOut = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await new Promise<void>((res) => chrome.storage.local.remove('authToken', res));
    setIsLinked(false);
    setSyncStatus('idle');
  };

  const activeProviderLabel = PROVIDERS.find(p => p.id === provider)?.label || 'Configured Provider';

  const syncBadge =
    syncStatus === 'syncing' ? { color: '#f59e0b', label: '⟳ Syncing' } :
    syncStatus === 'synced'  ? { color: '#34d399', label: '✓ Synced'  } :
    syncStatus === 'error'   ? { color: '#f87171', label: '✗ Sync error' } :
    null;

  return (
    <div className="p-root">
      {/* ── Logo ── */}
      <div className="p-logo-wrap">
        <div className="p-logo">?</div>
        <span className="p-logo-label">huh?</span>
      </div>

      {/* ── Tabs ── */}
      <div className="p-tabs">
        <button
          className={`p-tab ${tab === 'dashboard' ? 'p-tab--active' : ''}`}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`p-tab ${tab === 'byok' ? 'p-tab--active' : ''}`}
          onClick={() => setTab('byok')}
        >
          BYOK
        </button>
      </div>

      {/* ── Dashboard panel ── */}
      {tab === 'dashboard' && (
        <div className="p-panel">
          {/* Active Status Header */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15))',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#34d399',
                  boxShadow: '0 0 8px #34d399',
                  display: 'inline-block'
                }}></span>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#f3f4f6' }}>Engine Active</span>
              </div>
              <span style={{ fontSize: '10px', background: 'rgba(99,102,241,0.25)', color: '#c4b5fd', padding: '2px 8px', borderRadius: '12px', fontWeight: '600' }}>
                {activeProviderLabel}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: '#9ca3af' }}>
              Model: <code style={{ color: '#a5b4fc' }}>{PROVIDER_BRIDGE[provider]?.model}</code>
            </div>

            {/* Cloud sync badge */}
            {isLinked && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  ☁️ Linked to huh.app
                </span>
                {syncBadge && (
                  <span style={{ fontSize: '10px', color: syncBadge.color, fontWeight: '600' }}>
                    {syncBadge.label}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div style={{ background: '#18181f', border: '1px solid #2a2a38', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', color: '#6b6b8a', fontWeight: '600', textTransform: 'uppercase' }}>Cache Size</span>
              <span style={{ fontSize: '18px', fontWeight: '800', color: '#f3f4f6' }}>{cacheSize} <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: '400' }}>items</span></span>
            </div>

            <div style={{ background: '#18181f', border: '1px solid #2a2a38', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', color: '#6b6b8a', fontWeight: '600', textTransform: 'uppercase' }}>Trigger Mode</span>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#f3f4f6', marginTop: '4px' }}>
                {showTrigger && enableAltClick ? 'Hover + Alt' : showTrigger ? 'Trigger Only' : enableAltClick ? 'Alt Click' : 'Disabled'}
              </span>
            </div>
          </div>

          {/* Interaction Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#18181f', border: '1px solid #2a2a38', borderRadius: '8px', padding: '10px 12px' }}>
            <label className="p-check">
              <input
                type="checkbox"
                checked={showTrigger}
                onChange={e => {
                  const next = e.target.checked;
                  setShowTrigger(next);
                  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.set({ showTrigger: next });
                  }
                }}
              />
              Show "huh?" on selection
            </label>

            <label className="p-check">
              <input
                type="checkbox"
                checked={enableAltClick}
                onChange={e => {
                  const next = e.target.checked;
                  setEnableAltClick(next);
                  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.set({ enableAltClick: next });
                  }
                }}
              />
              Enable Alt + Click lookup
            </label>

            <div style={{ height: '1px', backgroundColor: '#2a2a38', margin: '4px 0' }}></div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: '#6b6b8a', fontWeight: '600', textTransform: 'uppercase' }}>Default Placement</span>
              <select
                value={cardPositionSetting}
                onChange={e => {
                  const next = e.target.value as any;
                  setCardPositionSetting(next);
                  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.set({ cardPositionSetting: next });
                  }
                }}
                style={{
                  background: '#13131a',
                  border: '1px solid #2a2a38',
                  borderRadius: '6px',
                  color: '#f3f4f6',
                  padding: '6px 8px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="selection">Follow Selection</option>
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            <button
              className="p-btn p-btn--primary"
              style={{ flex: 1, padding: '8px 10px', fontSize: '12px' }}
              onClick={() => setTab('byok')}
            >
              ⚙️ Configure Keys
            </button>

            <button
              className="p-social-btn"
              style={{ flex: 1, padding: '8px 10px', fontSize: '12px' }}
              onClick={handleClearCache}
            >
              🗑️ Clear Cache
            </button>
          </div>

          {!isLinked && (
            <a
              href="https://huh.app"
              target="_blank"
              rel="noreferrer"
              className="p-btn p-btn--full"
              style={{
                marginTop: '8px',
                textAlign: 'center',
                textDecoration: 'none',
                background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                border: 'none',
                color: '#fff',
                display: 'block'
              }}
            >
              Sign in at huh.app →
            </a>
          )}

          {/* Sign-out if logged in */}
          {isLinked && (
            <button
              className="p-social-btn"
              style={{ width: '100%', padding: '8px', fontSize: '12px', marginTop: '2px' }}
              onClick={handleSignOut}
            >
              Unlink account
            </button>
          )}
        </div>
      )}

      {/* ── BYOK panel ── */}
      {tab === 'byok' && (
        <div className="p-panel">
          {/* Provider pills */}
          <div className="p-pills">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`p-pill ${provider === p.id ? 'p-pill--active' : ''}`}
                onClick={() => handleProviderChange(p.id)}
              >
                {p.label} {keysMap[p.id] ? '✓' : ''}
              </button>
            ))}
          </div>

          {/* API key field */}
          <div className="p-field p-field--pw">
            <input
              id="byok-apikey"
              type={showKey ? 'text' : 'password'}
              className="p-input p-input--mono"
              placeholder={PROVIDERS.find(p => p.id === provider)?.placeholder ?? 'API Key'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="p-pw-toggle" onClick={() => setShowKey(v => !v)} type="button">
              {showKey ? '🙈' : '👁'}
            </button>
          </div>

          {/* Key status indicator */}
          <div style={{ fontSize: '11px', marginTop: '-4px', marginBottom: '8px', color: keysMap[provider] ? '#34d399' : '#f87171' }}>
            {keysMap[provider] ? `✓ Key configured for ${PROVIDERS.find(p => p.id === provider)?.label}` : `⚠️ No key set for ${PROVIDERS.find(p => p.id === provider)?.label}`}
          </div>

          {/* Cloud sync nudge */}
          {!isLinked && (
            <div style={{ fontSize: '11px', color: '#6b6b8a', marginBottom: '6px' }}>
              💡{' '}
              <a
                href="https://huh.app"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#a5b4fc', textDecoration: 'none' }}
              >
                Sign in at huh.app
              </a>
              {' '}to sync keys across devices.
            </div>
          )}

          {/* Status */}
          {byokStatus && (
            <div className={`p-status ${byokStatus.ok ? 'p-status--ok' : 'p-status--err'}`}>
              {byokStatus.msg}
            </div>
          )}

          {/* Save */}
          <button className="p-btn p-btn--primary p-btn--full" onClick={handleSave}>
            Save
          </button>

          {/* ── Toggles (collapsible) ── */}
          <button className="p-toggles-trigger" onClick={() => setShowToggles(v => !v)}>
            Interactions {showToggles ? '▲' : '▼'}
          </button>

          {showToggles && (
            <div className="p-toggles">
              <label className="p-check">
                <input
                  type="checkbox"
                  checked={showTrigger}
                  onChange={e => setShowTrigger(e.target.checked)}
                />
                Show "huh?" after selecting text
              </label>
              <label className="p-check">
                <input
                  type="checkbox"
                  checked={enableAltClick}
                  onChange={e => setEnableAltClick(e.target.checked)}
                />
                Enable Alt + Click lookup
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '4px 0 8px 0', width: '100%' }}>
                <span style={{ fontSize: '11px', color: '#6b6b8a', fontWeight: '600', textTransform: 'uppercase' }}>Default Placement</span>
                <select
                  value={cardPositionSetting}
                  onChange={e => setCardPositionSetting(e.target.value as any)}
                  style={{
                    background: '#13131a',
                    border: '1px solid #2a2a38',
                    borderRadius: '6px',
                    color: '#f3f4f6',
                    padding: '6px 8px',
                    fontSize: '12px',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '100%'
                  }}
                >
                  <option value="selection">Follow Selection</option>
                  <option value="top-left">Top Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>
              <button className="p-cache-btn" onClick={handleClearCache}>
                Clear lookup cache ({cacheSize})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
