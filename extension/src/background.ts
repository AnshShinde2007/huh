/// <reference types="chrome" />
// src/background.ts

interface CacheEntry {
  selection: string;
  context: string;
  response: {
    title: string;
    type: string;
    subtitle: string;
    description: string;
  };
  timestamp: number;
}

// Simple Jaccard similarity to verify context similarity
function calculateContextSimilarity(ctx1: string, ctx2: string): number {
  const getWords = (str: string) => new Set((str || '').toLowerCase().match(/\w+/g) || []);
  const words1 = getWords(ctx1);
  const words2 = getWords(ctx2);
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Find a matching entry in cache
async function getCachedExplanation(selection: string, context: string): Promise<CacheEntry['response'] | null> {
  const storage = await chrome.storage.local.get('lookupCache');
  const cache: CacheEntry[] = storage.lookupCache || [];
  
  const normalizedSelection = selection.trim().toLowerCase();
  
  // Find cache matches for the selection
  const matches = cache.filter(entry => entry.selection.trim().toLowerCase() === normalizedSelection);
  if (matches.length === 0) return null;
  
  // Look for the closest context match
  let bestMatch: CacheEntry | null = null;
  let highestSimilarity = -1;
  
  for (const match of matches) {
    const similarity = calculateContextSimilarity(match.context, context);
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      bestMatch = match;
    }
  }
  
  // If we have a match and it is sufficiently similar (threshold 0.3)
  if (bestMatch && highestSimilarity >= 0.3) {
    return bestMatch.response;
  }
  
  return null;
}

// Save explanation to cache (capped at 100 entries)
async function saveToCache(selection: string, context: string, response: CacheEntry['response']) {
  const storage = await chrome.storage.local.get('lookupCache');
  let cache: CacheEntry[] = storage.lookupCache || [];
  
  const newEntry: CacheEntry = {
    selection,
    context,
    response,
    timestamp: Date.now(),
  };
  
  // Remove duplicate selection/context combo if exists
  cache = cache.filter(
    entry => 
      !(entry.selection.toLowerCase() === selection.toLowerCase() && 
        calculateContextSimilarity(entry.context, context) > 0.8)
  );
  
  cache.unshift(newEntry);
  
  // Cap at 100 entries
  if (cache.length > 100) {
    cache = cache.slice(0, 100);
  }
  
  await chrome.storage.local.set({ lookupCache: cache });
}

// AI API calls handler
async function callAIProvider(
  text: string,
  context: string
): Promise<CacheEntry['response']> {
  const settings = await chrome.storage.local.get(['provider', 'apiKey', 'model', 'apiKeysMap']);
  const provider = settings.provider || 'anthropic';
  let model = settings.model;
  const apiKeysMap = settings.apiKeysMap || {};

  // Resolve provider-specific API key from apiKeysMap or fallback to global apiKey
  let apiKey = '';
  if (provider === 'groq') {
    apiKey = apiKeysMap['groq'] || settings.apiKey || '';
  } else if (provider === 'openrouter') {
    if (model === 'grok-4.5' || model === 'x-ai/grok-2' || model?.includes('grok')) {
      apiKey = apiKeysMap['grok'] || apiKeysMap['openrouter'] || settings.apiKey || '';
    } else {
      apiKey = apiKeysMap['openrouter'] || apiKeysMap['grok'] || settings.apiKey || '';
    }
  } else if (provider === 'anthropic') {
    apiKey = apiKeysMap['claude'] || settings.apiKey || '';
  } else if (provider === 'openai') {
    apiKey = apiKeysMap['chatgpt'] || settings.apiKey || '';
  } else if (provider === 'gemini') {
    apiKey = apiKeysMap['gemini'] || settings.apiKey || '';
  } else {
    apiKey = settings.apiKey || '';
  }

  apiKey = (apiKey || '').trim();

  if (!apiKey) {
    throw new Error(`API Key for ${provider} is missing. Please open the Huh? extension popup to configure your API key.`);
  }

  const prompt = `You are given text selected by a user while browsing a webpage.

Determine what the selected text refers to using the surrounding context.

Explain what it is or what it means specifically in this context.

If the selected text is ambiguous, prioritize the interpretation supported by the surrounding context.

Be concise. The user wants to understand the term without leaving the webpage.

Do not summarize the surrounding context itself. It exists only to help identify and explain the selected text.

Selected text: "${text}"
Surrounding context: "${context}"

Respond in a structured format with the following fields:
- Title: The canonical name or title of the entity (e.g. "React", "Apple Inc.", "Inference").
- Subtitle: A brief 2-3 word classification subtitle (e.g. "Container orchestration" for Kubernetes).
- Description: 1-3 sentences, strictly under 60 words. Avoid historical trivia, filler, or prompt meta-text. Use the surrounding context to give a context-specific explanation.
- Type: Classify the entity into exactly one of these categories: Word, Company, Person, Technology, Technical concept, Acronym, Organization, Product, Place, General concept, Unknown.`;

  if (provider === 'gemini') {
    const selectedModel = model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    
    const body = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'The canonical name/title of the entity (e.g., Kubernetes)' },
            type: { type: 'STRING', description: 'Entity classification category' },
            subtitle: { type: 'STRING', description: 'A 2-3 word subtitle' },
            description: { type: 'STRING', description: '1-3 sentence explanation' }
          },
          required: ['title', 'type', 'subtitle', 'description']
        }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error('Invalid response structure received from Gemini API.');
    }

    return JSON.parse(responseText);

  } else if (provider === 'openai') {
    const selectedModel = model || 'gpt-4o-mini';
    const url = 'https://api.openai.com/v1/chat/completions';
    
    const body = {
      model: selectedModel,
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'huh_explanation',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              type: { type: 'string' },
              subtitle: { type: 'string' },
              description: { type: 'string' }
            },
            required: ['title', 'type', 'subtitle', 'description'],
            additionalProperties: false
          },
          strict: true
        }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API Error (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Invalid response structure received from OpenAI API.');
    }

    return JSON.parse(content);

  } else if (provider === 'anthropic') {
    const selectedModel = model || 'claude-3-5-haiku-latest';
    const url = 'https://api.anthropic.com/v1/messages';
    
    const body = {
      model: selectedModel,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ],
      tools: [
        {
          name: 'explain_entity',
          description: 'Provide a structured explanation for the highlighted text.',
          input_schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Canonical title of the entity' },
              type: { type: 'string', description: 'Classification category' },
              subtitle: { type: 'string', description: '2-3 word subtitle summary' },
              description: { type: 'string', description: 'Concise explanation under 60 words' }
            },
            required: ['title', 'type', 'subtitle', 'description']
          }
        }
      ],
      tool_choice: {
        type: 'tool',
        name: 'explain_entity'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API Error (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const toolUseBlock = data.content?.find((c: any) => c.type === 'tool_use');
    if (!toolUseBlock || !toolUseBlock.input) {
      throw new Error('Anthropic API did not call the explain_entity tool.');
    }

    return toolUseBlock.input;

  } else if (provider === 'groq' || apiKey.startsWith('gsk_')) {
    const selectedModel = model || 'openai/gpt-oss-120b';
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    
    const body = {
      model: selectedModel,
      messages: [
        { role: 'user', content: prompt + '\nRespond ONLY with a valid JSON object matching schema with keys: title, type, subtitle, description.' }
      ],
      response_format: { type: 'json_object' }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API Error (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Invalid response structure received from Groq API.');
    }

    return JSON.parse(content);

  } else if (provider === 'openrouter' || apiKey.startsWith('xai-')) {
    // If the key starts with xai-, route directly to xAI API endpoint
    if (apiKey.startsWith('xai-')) {
      const selectedModel = model || 'grok-4.5';
      const url = 'https://api.x.ai/v1/chat/completions';
      
      const body = {
        model: selectedModel,
        messages: [
          { role: 'user', content: prompt + '\nRespond ONLY with a valid JSON object matching schema with keys: title, type, subtitle, description.' }
        ],
        response_format: { type: 'json_object' }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`xAI Grok API Error (${res.status}): ${errText || res.statusText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Invalid response structure received from xAI Grok API.');
      }

      return JSON.parse(content);
    }

    const selectedModel = model || 'google/gemini-2.5-flash';
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    
    const body = {
      model: selectedModel,
      messages: [
        { role: 'user', content: prompt + '\nRespond ONLY with a valid JSON object matching the schema.' }
      ],
      response_format: { type: 'json_object' }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/huh-extension',
        'X-Title': 'Huh? Extension'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401) {
        throw new Error(
          `OpenRouter Authentication Failed (401). Please make sure your OpenRouter API key (sk-or-v1-...) is entered in the extension popup and click Save.`
        );
      }
      throw new Error(`OpenRouter API Error (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Invalid response structure received from OpenRouter API.');
    }

    return JSON.parse(content);
  }
  
  throw new Error(`Unknown provider: ${provider}`);
}

// Listen to message from content script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'EXPLAIN_TEXT') {
    const { text, context } = request.payload;
    
    (async () => {
      try {
        // 1. Try Cache First
        const cached = await getCachedExplanation(text, context);
        if (cached) {
          sendResponse({ success: true, data: cached, cached: true });
          return;
        }
        
        // 2. Call API
        const data = await callAIProvider(text, context);
        
        // 3. Cache API result
        await saveToCache(text, context, data);
        
        sendResponse({ success: true, data, cached: false });
      } catch (error: any) {
        console.error('Background worker error:', error);
        sendResponse({ success: false, error: error.message || 'An unknown error occurred.' });
      }
    })();
    
    return true; // Keep message channel open for async response
  }
});

// Listen to message from external web page (landing page)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.type === 'AUTH_SUCCESS') {
    const { token } = request.payload;
    // We can store the token or just store the fact we are authenticated
    // For now, let's just forward it to popup via storage or sign in
    // Since we are moving Auth out of the popup, we can just save it to storage
    chrome.storage.local.set({ authToken: token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
