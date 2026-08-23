import { useState, useEffect } from 'react'
import { 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User
} from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider, githubProvider } from './firebase'
import './App.css'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState({ msg: '', isError: false })
  const [extensionId, setExtensionId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (u) {
        linkExtension(u)
      }
    })
    return () => unsub()
  }, [])

  const showStatus = (msg: string, isError = false) => {
    setStatus({ msg, isError })
  }

  const linkExtension = async (u: User) => {
    try {
      const token = await u.getIdToken()
      
      // Setup initial default settings in Firestore if they don't exist
      const settingsRef = doc(db, 'users', u.uid, 'settings', 'main')
      await setDoc(settingsRef, {
        updatedAt: new Date().toISOString()
      }, { merge: true })

      showStatus('Authenticated! You are signed in.', false)

      const idToUse = extensionId.trim()
      
      if (!idToUse) {
        return; // wait for user to enter extension ID and click link manually
      }

      // We use postMessage or try to reach out. Actually standard web pages use chrome.runtime.sendMessage
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(idToUse, { 
          type: 'AUTH_SUCCESS', 
          payload: { token: token } 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Could not connect to extension:", chrome.runtime.lastError.message)
            showStatus("Authenticated, but could not link to extension. Make sure it is installed and the Extension ID is correct.", true)
          } else if (response && response.success) {
            showStatus("Successfully linked to the huh? extension! You can now use the popup.", false)
          }
        })
      } else {
        showStatus("Authenticated, but you need to be in a Chromium browser with the extension installed to link.", true)
      }

    } catch (err: any) {
      console.error(err)
      showStatus('Error linking to extension: ' + err.message, true)
    }
  }

  const handleLinkClick = () => {
    if (user && extensionId.trim()) {
      linkExtension(user)
    } else {
      showStatus("Please enter an extension ID", true)
    }
  }

  const handleGoogle = async () => {
    try {
      setLoading(true)
      await signInWithPopup(auth, googleProvider)
    } catch (err: any) {
      showStatus(err.message, true)
    } finally {
      setLoading(false)
    }
  }

  const handleGithub = async () => {
    try {
      setLoading(true)
      await signInWithPopup(auth, githubProvider)
    } catch (err: any) {
      showStatus(err.message, true)
    } finally {
      setLoading(false)
    }
  }

  const handleEmailAuth = async () => {
    if (!email || !password) {
      showStatus("Please enter email and password", true)
      return
    }
    try {
      setLoading(true)
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, email, password)
        } catch (createErr: any) {
          showStatus(createErr.message, true)
        }
      } else {
        showStatus(err.message, true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-container">
      <header>
        <div className="logo">
          <div className="logo-mark">?</div>
          huh?
        </div>
      </header>

      <main>
        <h1>See something you don't know?</h1>
        <p className="subtitle">Highlight any text on any webpage and instantly get context-aware explanations powered by AI. Sign in to sync your API keys across all your devices.</p>

        <div className="auth-container">
          {status.msg && (
            <div className={`status-message ${status.isError ? 'status-error' : 'status-success'}`}>
              {status.msg}
            </div>
          )}

          {!user ? (
            <div className="auth-view">
              <button className="btn btn-outline" onClick={handleGoogle} disabled={loading}>
                Continue with Google
              </button>
              <button className="btn btn-outline" onClick={handleGithub} disabled={loading}>
                Continue with GitHub
              </button>

              <div className="divider">or</div>

              <div className="input-group">
                <input 
                  type="email" 
                  placeholder="Email address" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <input 
                  type="password" 
                  placeholder="Password" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleEmailAuth()}
                />
              </div>
              <button className="btn" onClick={handleEmailAuth} disabled={loading}>
                {loading ? 'Processing...' : 'Sign In / Register'}
              </button>
            </div>
          ) : (
            <div className="dashboard-view">
              <div className="user-info">
                <h3>Welcome!</h3>
                <p>{user.email || user.displayName || 'User'}</p>
              </div>
              
              <div className="extension-setup">
                <h4>Link Extension</h4>
                <p className="setup-help">
                  Enter your extension ID from <code>chrome://extensions</code> to link your account.
                </p>
                <div className="input-group" style={{ marginTop: '12px' }}>
                  <input 
                    type="text" 
                    placeholder="Extension ID (e.g. abcdefghijklmnop)" 
                    value={extensionId}
                    onChange={e => setExtensionId(e.target.value)}
                  />
                  <button className="btn" onClick={handleLinkClick}>Link Now</button>
                </div>
              </div>

              <button 
                className="btn btn-outline" 
                style={{ width: '100%', marginTop: '24px' }}
                onClick={() => {
                  signOut(auth)
                  setStatus({ msg: '', isError: false })
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
