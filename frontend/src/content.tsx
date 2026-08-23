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
  const [cardPositionSetting, setCardPositionSetting] = useState<'selection' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('selection');
  
  const [uiState, setUiState] = useState<UIState>('IDLE');
  const [selectionText, setSelectionText] = useState('');
  const [contextText, setContextText] = useState('');
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCached, setIsCached] = useState(false);
  
  const activeLookupRef = useRef<string | null>(null);

  // Dragging state
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, cardLeft: 0, cardTop: 0 });

  // Load interaction settings from local storage
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['showTrigger', 'enableAltClick', 'cardPositionSetting'], (result) => {
        if (result.showTrigger !== undefined) setShowTriggerSetting(result.showTrigger);
        if (result.enableAltClick !== undefined) setEnableAltClickSetting(result.enableAltClick);
        if (result.cardPositionSetting !== undefined) setCardPositionSetting(result.cardPositionSetting);
      });
    }
  }, []);

  // Listen to live settings changes from storage
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    
    const handleStorageChange = (changes: { [key: string]: any }, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes.showTrigger) {
        setShowTriggerSetting(changes.showTrigger.newValue);
      }
      if (changes.enableAltClick) {
        setEnableAltClickSetting(changes.enableAltClick.newValue);
      }
      if (changes.cardPositionSetting) {
        setCardPositionSetting(changes.cardPositionSetting.newValue);
      }
    };
    
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Semantic block-level elements that provide meaningful context
  const SEMANTIC_CONTEXT_ELEMENTS = new Set([
    'P', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION',
    'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'ARTICLE', 'SECTION', 'ASIDE',
  ]);

  // Hard cap: 500 chars total, split 250 before / 250 after the selection
  const CONTEXT_MAX_CHARS = 500;
  const CONTEXT_WINDOW_BEFORE = 250;
  const CONTEXT_WINDOW_AFTER = 250;

  /**
   * Walk up the DOM from `startNode` (max `maxLevels` steps) and return the
   * first element whose tag is a recognised semantic block element.
   * Falls back to `startNode.parentElement` if nothing is found.
   */
  const findSemanticAncestor = (startNode: Node, maxLevels = 6): HTMLElement | null => {
    let current: Node | null = startNode.nodeType === Node.TEXT_NODE
      ? startNode.parentElement
      : startNode as HTMLElement;

    for (let i = 0; i < maxLevels && current; i++) {
      if (current.nodeType === Node.ELEMENT_NODE && SEMANTIC_CONTEXT_ELEMENTS.has((current as HTMLElement).tagName)) {
        return current as HTMLElement;
      }
      current = current.parentElement;
    }

    // Fallback: immediate parent of the start node
    return startNode.nodeType === Node.TEXT_NODE
      ? (startNode as Text).parentElement
      : (startNode as HTMLElement);
  };

  /**
   * Extract a context window around `selectedText` from `fullText`.
   * Returns at most CONTEXT_MAX_CHARS characters, centred on the selection,
   * with whitespace normalised. Falls back to a prefix of fullText if the
   * selected text cannot be located inside fullText.
   */
  const sliceContextWindow = (fullText: string, selectedText: string): string => {
    // Normalise whitespace in the source text (preserves words, collapses runs)
    const normalised = fullText.replace(/\s+/g, ' ').trim();
    const idx = normalised.indexOf(selectedText.trim());

    if (idx === -1) {
      // Can't locate selection — return a hard-capped prefix as best-effort
      return normalised.slice(0, CONTEXT_MAX_CHARS);
    }

    const selEnd = idx + selectedText.trim().length;
    const start = Math.max(0, idx - CONTEXT_WINDOW_BEFORE);
    const end = Math.min(normalised.length, selEnd + CONTEXT_WINDOW_AFTER);

    let excerpt = normalised.slice(start, end).trim();

    // Add ellipsis markers so the model knows it's a fragment
    if (start > 0) excerpt = '…' + excerpt;
    if (end < normalised.length) excerpt = excerpt + '…';

    return excerpt;
  };

  /**
   * Extract surrounding context for a Selection.
   *
   * Strategy:
   * 1. For multi-node selections, use the common ancestor element's text.
   * 2. For single-node selections, walk up to the nearest semantic ancestor.
   * 3. Slice a 500-char window centred on the selected text.
   * 4. Fallback to '' if nothing meaningful can be found.
   */
  const extractContext = (selection: Selection): string => {
    try {
      if (selection.rangeCount === 0) return '';
      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();
      if (!selectedText) return '';

      let sourceElement: HTMLElement | null = null;

      if (range.startContainer === range.endContainer) {
        // Single text node — walk up for a semantic ancestor
        sourceElement = findSemanticAncestor(range.startContainer);
      } else {
        // Multi-node selection — use the common ancestor which spans all nodes
        const common = range.commonAncestorContainer;
        if (common.nodeType === Node.ELEMENT_NODE) {
          sourceElement = common as HTMLElement;
        } else {
          sourceElement = (common as Text).parentElement;
        }
        // If the common ancestor is very large (e.g. body/article), prefer
        // a semantic ancestor of startContainer instead
        if (sourceElement && !SEMANTIC_CONTEXT_ELEMENTS.has(sourceElement.tagName)) {
          const semantic = findSemanticAncestor(range.startContainer);
          if (semantic) sourceElement = semantic;
        }
      }

      if (!sourceElement) return '';

      const fullText = sourceElement.textContent || '';
      return sliceContextWindow(fullText, selectedText);
    } catch {
      return '';
    }
  };

  /**
   * Extract context from a plain Range (used by the Alt+Click handler which
   * builds its own range rather than relying on window.getSelection()).
   */
  const extractContextFromRange = (range: Range, selectedText: string): string => {
    try {
      if (!selectedText) return '';

      // Walk up from the start container to find a semantic ancestor
      const sourceElement = findSemanticAncestor(range.startContainer);
      if (!sourceElement) return '';

      const fullText = sourceElement.textContent || '';
      return sliceContextWindow(fullText, selectedText);
    } catch {
      return '';
    }
  };

  // Perform the lookup via background worker
  const performLookup = (text: string, context: string) => {
    setUiState('LOADING');
    setErrorMessage('');
    setExplanation(null);
    setIsCached(false);
    setCardPosition(null);
    
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
            setCardPosition(null);
          }
          return;
        }

        // If selection trigger is disabled, do nothing
        if (!showTriggerSetting) return;

        // Save selection details
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        setSelectionText(text);
        setContextText(extractContext(selection));
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

            // Use the shared context extractor (semantic ancestor walking + 500-char cap)
            const context = extractContextFromRange(wordRange, word);

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
      setCardPosition(null);
    };

    document.addEventListener('mousedown', handleDismiss);
    return () => document.removeEventListener('mousedown', handleDismiss);
  }, []);

  if (uiState === 'IDLE' || !selectionRect) return null;

  // Position calculations
  const getTriggerPosition = () => {
    return {
      left: `${selectionRect.right}px`,
      top: `${selectionRect.bottom}px`
    };
  };

  const getCardPositionCoords = () => {
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
    
    return { left: cardX, top: cardY };
  };

  const getCardPosition = () => {
    const coords = getCardPositionCoords();
    return {
      left: `${coords.left}px`,
      top: `${coords.top}px`
    };
  };

  const getCurrentCardStyle = () => {
    if (cardPosition) {
      return {
        left: `${cardPosition.left}px`,
        top: `${cardPosition.top}px`,
        transform: 'none',
        animation: 'none'
      };
    }

    switch (cardPositionSetting) {
      case 'top-left':
        return {
          left: '16px',
          top: '16px',
          right: 'auto',
          bottom: 'auto',
          transform: 'none'
        };
      case 'top-right':
        return {
          right: '16px',
          top: '16px',
          left: 'auto',
          bottom: 'auto',
          transform: 'none'
        };
      case 'bottom-left':
        return {
          left: '16px',
          bottom: '16px',
          top: 'auto',
          right: 'auto',
          transform: 'none'
        };
      case 'bottom-right':
        return {
          right: '16px',
          bottom: '16px',
          left: 'auto',
          top: 'auto',
          transform: 'none'
        };
      case 'selection':
      default:
        return getCardPosition();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // only left click

    const target = e.target as HTMLElement;
    if (
      target.tagName === 'BUTTON' ||
      target.tagName === 'A' ||
      target.closest('.huh-close-btn') ||
      target.closest('.huh-retry-btn')
    ) {
      return;
    }

    if (target.closest('.huh-description')) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);

    let startLeft = 0;
    let startTop = 0;
    if (cardPosition) {
      startLeft = cardPosition.left;
      startTop = cardPosition.top;
    } else {
      const pos = getCardPositionCoords();
      startLeft = pos.left;
      startTop = pos.top;
    }

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      cardLeft: startLeft,
      cardTop: startTop
    };

    target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartRef.current.mouseX;
    const deltaY = e.clientY - dragStartRef.current.mouseY;

    let newLeft = dragStartRef.current.cardLeft + deltaX;
    let newTop = dragStartRef.current.cardTop + deltaY;

    const cardWidth = 290;
    newLeft = Math.max(8, Math.min(window.innerWidth - cardWidth - 8, newLeft));
    newTop = Math.max(8, Math.min(window.innerHeight - 40, newTop));

    setCardPosition({ left: newLeft, top: newTop });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
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
        <div 
          className={`huh-card ${isDragging ? 'huh-dragging' : ''}`} 
          style={getCurrentCardStyle()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
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
