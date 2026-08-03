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

// ── Icon components ──────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <path d="M14.95 9.53c-.02-2.15 1.76-3.19 1.84-3.24-1-1.47-2.56-1.67-3.12-1.69-1.33-.14-2.59.79-3.26.79-.67 0-1.71-.77-2.81-.75-1.45.02-2.79.84-3.53 2.13-1.51 2.6-.39 6.46 1.08 8.57.72 1.04 1.58 2.2 2.71 2.16 1.09-.04 1.5-.7 2.82-.7 1.31 0 1.68.7 2.83.68 1.17-.02 1.91-1.06 2.62-2.1.83-1.2 1.17-2.37 1.19-2.43-.03-.01-2.34-.9-2.37-3.42ZM12.73 3.3C13.3 2.6 13.7 1.62 13.58.62c-.85.04-1.87.57-2.48 1.27-.54.62-1.02 1.62-.89 2.57.93.07 1.87-.47 2.52-1.16Z"/>
    </svg>
  );
}

// ── Main Popup ───────────────────────────────────────────────────────────────

export default function Popup() {
  const [tab, setTab] = useState<'dashboard' | 'signin' | 'byok'>('byok');

  // BYOK state
  const [provider, setProvider] = useState<ProviderId>('claude');
  const [apiKey, setApiKey]     = useState('');
  const [keysMap, setKeysMap]   = useState<Record<string, string>>({});
  const [showKey, setShowKey]   = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [byokStatus, setByokStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Signin state
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Interaction toggles (persisted, accessible from BYOK tab footer)
  const [showTrigger, setShowTrigger]     = useState(true);
  const [enableAltClick, setEnableAltClick] = useState(true);
  const [showToggles, setShowToggles]     = useState(false);

  // Load saved state on mount
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(
      ['provider', 'apiKey', 'apiKeysMap', 'showTrigger', 'enableAltClick', 'lookupCache'],
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
        if (Array.isArray(result.lookupCache)) setCacheSize(result.lookupCache.length);

        // If an API key is already saved, default to Dashboard view
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

    // Synchronize active provider and key in storage if a key exists
    if (keyForProvider && typeof chrome !== 'undefined' && chrome.storage?.local) {
      const bridge = PROVIDER_BRIDGE[newProvider];
      chrome.storage.local.set({
        provider: bridge.bgId,
        model: bridge.model,
        apiKey: keyForProvider
      });
    }
  };

  // ── BYOK save ───────────────────────────────────────────────────────────────
  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setByokStatus({ ok: false, msg: 'API key cannot be empty.' });
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const bridge = PROVIDER_BRIDGE[provider];
    const updatedMap = { ...keysMap, [provider]: trimmed };
    setKeysMap(updatedMap);

    chrome.storage.local.set(
      {
        provider: bridge.bgId,
        apiKey: trimmed,
        model: bridge.model,
        apiKeysMap: updatedMap,
        showTrigger,
        enableAltClick
      },
      () => {
        const provLabel = PROVIDERS.find(p => p.id === provider)?.label || provider;
        setByokStatus({ ok: true, msg: `Key saved for ${provLabel}!` });
        setTimeout(() => {
          setByokStatus(null);
          setTab('dashboard');
        }, 1000);
      }
    );
  };

  const handleClearCache = () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.set({ lookupCache: [] }, () => {
      setCacheSize(0);
      setByokStatus({ ok: true, msg: 'Cache cleared.' });
      setTimeout(() => setByokStatus(null), 2000);
    });
  };

  const activeProviderLabel = PROVIDERS.find(p => p.id === provider)?.label || 'Configured Provider';

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
        <button
          className={`p-tab ${tab === 'signin' ? 'p-tab--active' : ''}`}
          onClick={() => setTab('signin')}
        >
          Sign in
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
        </div>
      )}

      {/* ── Sign-in panel ── */}
      {tab === 'signin' && (
        <div className="p-panel">
          <div className="p-social-row">
            <button className="p-social-btn" title="Continue with Google">
              <GoogleIcon />
              <span>Google</span>
            </button>
            <button className="p-social-btn" title="Continue with Apple">
              <AppleIcon />
              <span>Apple</span>
            </button>
          </div>

          <div className="p-divider">
            <span>or</span>
          </div>

          <div className="p-field">
            <input
              id="signin-email"
              type="email"
              className="p-input"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="p-field p-field--pw">
            <input
              id="signin-password"
              type={showPass ? 'text' : 'password'}
              className="p-input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className="p-pw-toggle" onClick={() => setShowPass(v => !v)} type="button">
              {showPass ? '🙈' : '👁'}
            </button>
          </div>

          <button className="p-btn p-btn--primary p-btn--full">
            Sign in
          </button>

          <p className="p-footnote">
            Sign-in enables cloud sync of your preferences.<br />
            <em>Coming in V2 — use BYOK for now.</em>
          </p>
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
