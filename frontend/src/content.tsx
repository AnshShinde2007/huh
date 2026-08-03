/// <reference types="chrome" />
// src/content.tsx
import { createRoot } from 'react-dom/client';
import { useState, useEffect, useRef } from 'react';
import cssStyles from './content.css?inline';

interface ExplanationResponse {
  title: string;
  type: string;
  subtitle: string;
  description: string;
}

type UIState = 'IDLE' | 'TRIGGER_SHOWING' | 'LOADING' | 'EXPLAINED' | 'ERROR';

interface Rect {
  left: number;
  top: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

function FloatingManager() {
  const [showTriggerSetting, setShowTriggerSetting] = useState(true);
  const [enableAltClickSetting, setEnableAltClickSetting] = useState(true);
  
  const [uiState, setUiState] = useState<UIState>('IDLE');
  const [selectionText, setSelectionText] = useState('');
  const [contextText, setContextText] = useState('');
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCached, setIsCached] = useState(false);
  
  const activeLookupRef = useRef<string | null>(null);

  // Load interaction settings from local storage
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['showTrigger', 'enableAltClick'], (result) => {
        if (result.showTrigger !== undefined) setShowTriggerSetting(result.showTrigger);
        if (result.enableAltClick !== undefined) setEnableAltClickSetting(result.enableAltClick);
      });
    }
  }, []);

  // Helper to extract sentence context
  const getSurroundingContext = (selection: Selection): string => {
    try {
      if (selection.rangeCount === 0) return '';
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const parentElement = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      if (!parentElement) return '';
      
      const fullText = parentElement.textContent || '';
      const selectedText = selection.toString();
      if (!selectedText) return '';
      
      const index = fullText.indexOf(selectedText);
      if (index === -1) return fullText.slice(0, 500);
      
      // Sentences boundaries finder
      let sentenceStart = 0;
      for (let i = index - 1; i >= 0; i--) {
        if (['.', '!', '?'].includes(fullText[i]) && (i === 0 || /\s/.test(fullText[i + 1]))) {
          sentenceStart = i + 1;
          break;
        }
      }
      
      let sentenceEnd = fullText.length;
      for (let i = index + selectedText.length; i < fullText.length; i++) {
        if (['.', '!', '?'].includes(fullText[i]) && (i === fullText.length - 1 || /\s/.test(fullText[i + 1]))) {
          sentenceEnd = i + 1;
          break;
        }
      }
      
      const currentSentence = fullText.slice(sentenceStart, sentenceEnd).trim();
      
      // Sentence before
      let prevSentence = '';
      if (sentenceStart > 0) {
        let prevStart = 0;
        for (let i = sentenceStart - 2; i >= 0; i--) {
          if (['.', '!', '?'].includes(fullText[i]) && (i === 0 || /\s/.test(fullText[i + 1]))) {
            prevStart = i + 1;
            break;
          }
        }
        prevSentence = fullText.slice(prevStart, sentenceStart).trim();
      }
      
      // Sentence after
      let nextSentence = '';
      if (sentenceEnd < fullText.length) {
        let nextEnd = fullText.length;
        for (let i = sentenceEnd + 1; i < fullText.length; i++) {
          if (['.', '!', '?'].includes(fullText[i]) && (i === fullText.length - 1 || /\s/.test(fullText[i + 1]))) {
            nextEnd = i + 1;
            break;
          }
        }
        nextSentence = fullText.slice(sentenceEnd, nextEnd).trim();
      }
      
      const result = [prevSentence, currentSentence, nextSentence].filter(Boolean).join(' ');
      return result.length > 500 ? result.slice(0, 500) : result;
    } catch (e) {
      return '';
    }
  };

  // Perform the lookup via background worker
  const performLookup = (text: string, context: string) => {
    setUiState('LOADING');
    setErrorMessage('');
    setExplanation(null);
    setIsCached(false);
    
    activeLookupRef.current = text;
    
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      setErrorMessage('Extension context not available. Please ensure the extension is installed and refresh the page.');
      setUiState('ERROR');
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: 'EXPLAIN_TEXT',
          payload: { text, context }
        },
        (response) => {
          // Check lastError to handle extension context invalidation or disconnect
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            if (activeLookupRef.current !== text) return;
            setErrorMessage(chrome.runtime.lastError.message || 'Extension connection error. Please refresh the page.');
            setUiState('ERROR');
            return;
          }

          // Ensure we only process if this is still the active lookup
          if (activeLookupRef.current !== text) return;
          
          if (response && response.success) {
            setExplanation(response.data);
            setIsCached(!!response.cached);
            setUiState('EXPLAINED');
          } else {
            setErrorMessage(response?.error || 'Failed to fetch description. Make sure API key is configured.');
            setUiState('ERROR');
          }
        }
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to communicate with extension background script.');
      setUiState('ERROR');
    }
  };

  // Main listener for normal text selection
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // 1. Ignore click events that occur inside our Shadow DOM
      const path = e.composedPath();
      const shadowHost = document.getElementById('huh-root');
      if (shadowHost && path.includes(shadowHost)) return;

      // Small delay to let selection update
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection) return;

        const text = selection.toString().trim();
        
        // If selection is empty, hide unless we are in loading/explained state
        if (!text) {
          if (uiState === 'TRIGGER_SHOWING') {
            setUiState('IDLE');
          }
          return;
        }

        // If selection trigger is disabled, do nothing
        if (!showTriggerSetting) return;

        // Save selection details
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        setSelectionText(text);
        setContextText(getSurroundingContext(selection));
        setSelectionRect({
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
          right: rect.right,
          width: rect.width,
          height: rect.height
        });
        
        setUiState('TRIGGER_SHOWING');
      }, 10);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [uiState, showTriggerSetting]);

  // Listener for Alt+Click interaction (unselectable text fallback)
  useEffect(() => {
    const handleAltClick = (e: MouseEvent) => {
      if (!enableAltClickSetting || !e.altKey) return;
      
      e.preventDefault();
      e.stopPropagation();

      let textNode: Node | null = null;
      let offset = 0;

      // Caret standard APIs
      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          textNode = pos.offsetNode;
          offset = pos.offset;
        }
      } else if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (r) {
          textNode = r.startContainer;
          offset = r.startOffset;
        }
      }

      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.nodeValue || '';
        
        // Boundary check using word regex
        const preCaret = text.substring(0, offset);
        const postCaret = text.substring(offset);
        
        const wordStartOffset = preCaret.search(/[a-zA-Z0-9-_]*$/);
        const wordEndOffset = postCaret.search(/[^a-zA-Z0-9-_]/);
        
        const wordStart = wordStartOffset !== -1 ? wordStartOffset : offset;
        const wordEnd = wordEndOffset !== -1 ? offset + wordEndOffset : text.length;
        
        const word = text.substring(wordStart, wordEnd).trim();
        
        if (word && word.length > 1) {
          // Calculate bounding box for the extracted word using temp range
          try {
            const wordRange = document.createRange();
            wordRange.setStart(textNode, wordStart);
            wordRange.setEnd(textNode, wordEnd);
            const rect = wordRange.getBoundingClientRect();
            
            // Build context around word
            const parentElement = textNode.parentElement;
            const fullParentText = parentElement?.textContent || '';
            const contextIndex = fullParentText.indexOf(text);
            const absoluteWordIndex = (contextIndex !== -1 ? contextIndex : 0) + wordStart;
            
            // Basic sentence-splitter for Alt+Click context
            let sentenceStart = 0;
            for (let i = absoluteWordIndex - 1; i >= 0; i--) {
              if (['.', '!', '?'].includes(fullParentText[i]) && (i === 0 || /\s/.test(fullParentText[i + 1]))) {
                sentenceStart = i + 1;
                break;
              }
            }
            let sentenceEnd = fullParentText.length;
            for (let i = absoluteWordIndex + word.length; i < fullParentText.length; i++) {
              if (['.', '!', '?'].includes(fullParentText[i]) && (i === fullParentText.length - 1 || /\s/.test(fullParentText[i + 1]))) {
                sentenceEnd = i + 1;
                break;
              }
            }
            
            const context = fullParentText.slice(sentenceStart, sentenceEnd).trim();
            
            setSelectionText(word);
            setContextText(context);
            setSelectionRect({
              left: rect.left,
              top: rect.top,
              bottom: rect.bottom,
              right: rect.right,
              width: rect.width,
              height: rect.height
            });
            
            // Trigger direct lookup bypassing trigger button
            performLookup(word, context);
          } catch (err) {
            console.error('Alt-click word range parsing failed:', err);
          }
        }
      }
    };

    document.addEventListener('click', handleAltClick, true);
    return () => document.removeEventListener('click', handleAltClick, true);
  }, [enableAltClickSetting]);

  // Handle click outside to dismiss
  useEffect(() => {
    const handleDismiss = (e: MouseEvent) => {
      const path = e.composedPath();
      const shadowHost = document.getElementById('huh-root');
      if (shadowHost && path.includes(shadowHost)) return;
      
      setUiState('IDLE');
    };

    document.addEventListener('mousedown', handleDismiss);
    return () => document.removeEventListener('mousedown', handleDismiss);
  }, []);

  if (uiState === 'IDLE' || !selectionRect) return null;

  // Position calculations
  const getTriggerPosition = () => {
    return {
      left: `${window.scrollX + selectionRect.right}px`,
      top: `${window.scrollY + selectionRect.bottom}px`
    };
  };

  const getCardPosition = () => {
    let cardX = selectionRect.left;
    let cardY = selectionRect.bottom + 8; // 8px gap below selection
    
    // Check right screen boundary
    if (cardX + 290 > window.innerWidth - 16) {
      cardX = Math.max(16, window.innerWidth - 290 - 16);
    }
    // Check left screen boundary
    if (cardX < 16) {
      cardX = 16;
    }
    
    // Check bottom screen boundary (Estimated card height 180px)
    const estimatedCardHeight = 180;
    if (selectionRect.bottom + 8 + estimatedCardHeight > window.innerHeight) {
      cardY = selectionRect.top - estimatedCardHeight - 8;
    }
    
    return {
      left: `${window.scrollX + cardX}px`,
      top: `${window.scrollY + cardY}px`
    };
  };

  return (
    <>
      {uiState === 'TRIGGER_SHOWING' && (
        <button
          className="huh-trigger-btn"
          style={getTriggerPosition()}
          onClick={() => performLookup(selectionText, contextText)}
        >
          <span>huh?</span>
        </button>
      )}

      {(uiState === 'LOADING' || uiState === 'EXPLAINED' || uiState === 'ERROR') && (
        <div className="huh-card" style={getCardPosition()}>
          <button className="huh-close-btn" onClick={() => setUiState('IDLE')}>
            &times;
          </button>
          
          {uiState === 'LOADING' && (
            <div className="huh-skeleton">
              <div className="huh-shimmer huh-skeleton-title"></div>
              <div className="huh-shimmer huh-skeleton-badge"></div>
              <div className="huh-shimmer huh-skeleton-desc-1"></div>
              <div className="huh-shimmer huh-skeleton-desc-2"></div>
              <div className="huh-shimmer huh-skeleton-desc-3"></div>
            </div>
          )}

          {uiState === 'EXPLAINED' && explanation && (
            <>
              <div className="huh-header">
                <div className="huh-title">{explanation.title}</div>
                <div className="huh-meta">
                  <span className="huh-type-badge">{explanation.type}</span>
                  {explanation.subtitle && (
                    <span className="huh-subtitle">&middot; {explanation.subtitle}</span>
                  )}
                </div>
              </div>
              
              <div className="huh-divider"></div>
              
              <div className="huh-description">
                {explanation.description}
              </div>
              
              {isCached && (
                <div className="huh-footer">
                  Instant Cache Hit
                </div>
              )}
            </>
          )}

          {uiState === 'ERROR' && (
            <div className="huh-error-container">
              <div className="huh-error-icon">⚠️</div>
              <div className="huh-error-text">{errorMessage}</div>
              <button 
                className="huh-retry-btn" 
                onClick={() => performLookup(selectionText, contextText)}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Bootstrap React inside Shadow DOM
function init() {
  if (document.getElementById('huh-root')) return;

  const host = document.createElement('div');
  host.id = 'huh-root';
  
  // Ensure the root container sits on top of everything
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100%';
  host.style.pointerEvents = 'none'; // Allow clicks to pass through to underlying text
  
  // Attach shadow root
  const shadow = host.attachShadow({ mode: 'open' });
  
  // Create styles container
  const styleEl = document.createElement('style');
  styleEl.textContent = cssStyles;
  shadow.appendChild(styleEl);
  
  // Create React root mount wrapper
  const container = document.createElement('div');
  container.id = 'huh-container';
  container.style.pointerEvents = 'auto'; // Re-enable pointer events for extension components
  shadow.appendChild(container);
  
  document.documentElement.appendChild(host);
  
  const root = createRoot(container);
  root.render(<FloatingManager />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
export {};
