/// <reference types="chrome" />
// src/popup.tsx
import { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  GithubAuthProvider,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

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

// ── Firestore helpers ────────────────────────────────────────────────────────

interface CloudSettings {
  apiKeysMap: Record<string, string>;
  provider: string;
  model: string;
  showTrigger: boolean;
  enableAltClick: boolean;
  cardPositionSetting: string;
}

async function loadCloudSettings(uid: string): Promise<CloudSettings | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'main'));
    if (snap.exists()) return snap.data() as CloudSettings;
  } catch (e) {
    console.warn('Firestore read failed:', e);
  }
  return null;
}

async function saveCloudSettings(uid: string, settings: CloudSettings): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid, 'settings', 'main'), settings, { merge: true });
  } catch (e) {
    console.warn('Firestore write failed:', e);
  }
}

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

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

// ── Main Popup ───────────────────────────────────────────────────────────────

export default function Popup() {
  const [tab, setTab] = useState<'dashboard' | 'signin' | 'byok'>('byok');

  // Firebase auth state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  // BYOK state
  const [provider, setProvider] = useState<ProviderId>('claude');
  const [apiKey, setApiKey]     = useState('');
  const [keysMap, setKeysMap]   = useState<Record<string, string>>({});
  const [showKey, setShowKey]   = useState(false);
  const [cacheSize, setCacheSize] = useState(0);
  const [byokStatus, setByokStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Signin state
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError]   = useState<string | null>(null);
  const [authBusy, setAuthBusy]     = useState(false);

  // Interaction toggles (persisted, accessible from BYOK tab footer)
  const [showTrigger, setShowTrigger]         = useState(true);
  const [enableAltClick, setEnableAltClick]   = useState(true);
  const [cardPositionSetting, setCardPositionSetting] = useState<'selection' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('selection');
  const [showToggles, setShowToggles]         = useState(false);

  // ── Firebase auth listener ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);

      if (user) {
        // Signed in — load cloud settings and merge
        setSyncStatus('syncing');
        const cloud = await loadCloudSettings(user.uid);
        if (cloud) {
          // Apply cloud settings to local storage and state
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({
              provider: cloud.provider,
              model: cloud.model,
              apiKey: Object.values(cloud.apiKeysMap)[0] || '',
              apiKeysMap: cloud.apiKeysMap,
              showTrigger: cloud.showTrigger,
              enableAltClick: cloud.enableAltClick,
              cardPositionSetting: cloud.cardPositionSetting,
            });
          }
          setKeysMap(cloud.apiKeysMap || {});
          if (cloud.showTrigger !== undefined) setShowTrigger(cloud.showTrigger);
          if (cloud.enableAltClick !== undefined) setEnableAltClick(cloud.enableAltClick);
          if (cloud.cardPositionSetting) setCardPositionSetting(cloud.cardPositionSetting as any);

          // Resolve current provider from cloud
          const found = Object.entries(PROVIDER_BRIDGE).find(([, v]) => v.bgId === cloud.provider);
          if (found) {
            const prov = found[0] as ProviderId;
            setProvider(prov);
            setApiKey(cloud.apiKeysMap[prov] || '');
          }
          setSyncStatus('synced');
        } else {
          setSyncStatus('idle');
        }
        setTab('dashboard');
      }
    });
    return unsub;
  }, []);

  // ── Load saved local state on mount ──────────────────────────────────────
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(
      ['provider', 'apiKey', 'apiKeysMap', 'showTrigger', 'enableAltClick', 'cardPositionSetting', 'lookupCache'],
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

        // If an API key is already saved and no cloud user yet, show dashboard
        if (!authLoading && !firebaseUser && (result.apiKey || Object.keys(loadedMap).length > 0)) {
          setTab('dashboard');
        }
      }
    );
  }, [authLoading, firebaseUser]);

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

    // 2. Sync to Firestore if signed in
    if (firebaseUser) {
      setSyncStatus('syncing');
      await saveCloudSettings(firebaseUser.uid, {
        apiKeysMap: updatedMap,
        provider: bridge.bgId,
        model: bridge.model,
        showTrigger,
        enableAltClick,
        cardPositionSetting,
      });
      setSyncStatus('synced');
    }

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

  // ── Auth actions ──────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      // onAuthStateChanged will handle the rest
    } catch (e: any) {
      setAuthError(e.message || 'Google sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGitHubSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, new GithubAuthProvider());
    } catch (e: any) {
      setAuthError(e.message || 'GitHub sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailAuth = async () => {
    if (!email || !password) {
      setAuthError('Email and password are required.');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e: any) {
      // Surface a friendly message
      const msg: string = e.message || '';
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setAuthError('Invalid email or password.');
      } else if (msg.includes('email-already-in-use')) {
        setAuthError('Email already in use. Try signing in instead.');
      } else if (msg.includes('weak-password')) {
        setAuthError('Password must be at least 6 characters.');
      } else {
        setAuthError(msg);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setSyncStatus('idle');
    setFirebaseUser(null);
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
        <button
          className={`p-tab ${tab === 'signin' ? 'p-tab--active' : ''}`}
          onClick={() => setTab('signin')}
        >
          {firebaseUser ? 'Account' : 'Sign in'}
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
            {firebaseUser && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  ☁️ {firebaseUser.displayName || firebaseUser.email}
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

          {/* Sign-out if logged in */}
          {firebaseUser && (
            <button
              className="p-social-btn"
              style={{ width: '100%', padding: '8px', fontSize: '12px', marginTop: '2px' }}
              onClick={handleSignOut}
            >
              Sign out
            </button>
          )}
        </div>
      )}

      {/* ── Sign-in / Account panel ── */}
      {tab === 'signin' && (
        <div className="p-panel">
          {firebaseUser ? (
            /* ── Signed-in account view ── */
            <>
              <div style={{
                background: 'linear-gradient(135deg, rgba(52,211,153,0.1), rgba(99,102,241,0.1))',
                border: '1px solid rgba(52,211,153,0.3)',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                alignItems: 'center',
                textAlign: 'center'
              }}>
                {firebaseUser.photoURL && (
                  <img
                    src={firebaseUser.photoURL}
                    alt="avatar"
                    style={{ width: '44px', height: '44px', borderRadius: '50%', border: '2px solid rgba(99,102,241,0.4)' }}
                  />
                )}
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#f3f4f6' }}>
                  {firebaseUser.displayName || 'Signed in'}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                  {firebaseUser.email}
                </div>
                {syncBadge && (
                  <div style={{ fontSize: '11px', color: syncBadge.color, fontWeight: '600', marginTop: '2px' }}>
                    {syncBadge.label}
                  </div>
                )}
              </div>

              <p className="p-footnote" style={{ marginTop: '8px' }}>
                Your API keys and settings are synced to the cloud.
              </p>

              <button
                className="p-btn p-btn--primary p-btn--full"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            </>
          ) : (
            /* ── Sign-in form ── */
            <>
              <div className="p-social-row">
                <button
                  id="btn-google-signin"
                  className="p-social-btn"
                  title="Continue with Google"
                  onClick={handleGoogleSignIn}
                  disabled={authBusy}
                >
                  <GoogleIcon />
                  <span>Google</span>
                </button>
                <button
                  id="btn-github-signin"
                  className="p-social-btn"
                  title="Continue with GitHub"
                  onClick={handleGitHubSignIn}
                  disabled={authBusy}
                >
                  <GitHubIcon />
                  <span>GitHub</span>
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
                  onKeyDown={e => e.key === 'Enter' && handleEmailAuth()}
                />
                <button className="p-pw-toggle" onClick={() => setShowPass(v => !v)} type="button">
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>

              {/* Error display */}
              {authError && (
                <div className="p-status p-status--err" style={{ marginBottom: '4px' }}>
                  {authError}
                </div>
              )}

              <button
                id="btn-email-auth"
                className="p-btn p-btn--primary p-btn--full"
                onClick={handleEmailAuth}
                disabled={authBusy}
              >
                {authBusy ? '…' : isRegistering ? 'Create account' : 'Sign in'}
              </button>

              <button
                className="p-toggles-trigger"
                style={{ marginTop: '6px' }}
                onClick={() => {
                  setIsRegistering(v => !v);
                  setAuthError(null);
                }}
              >
                {isRegistering ? 'Already have an account? Sign in' : 'No account? Create one'}
              </button>

              <p className="p-footnote">
                Sign-in syncs your API keys and settings across devices.
              </p>
            </>
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
          {!firebaseUser && (
            <div style={{ fontSize: '11px', color: '#6b6b8a', marginBottom: '6px' }}>
              💡{' '}
              <button
                style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                onClick={() => setTab('signin')}
              >
                Sign in
              </button>
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
            Save{firebaseUser ? ' & Sync' : ''}
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
