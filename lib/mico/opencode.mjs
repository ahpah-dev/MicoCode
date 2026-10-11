// OpenCode uses Models.dev for pricing/capabilities. Zen's own /models endpoint
// confirms availability but deliberately contains no price or protocol fields.
export const OPENCODE_BASE = 'https://opencode.ai/zen/v1';
export const OPENCODE_METADATA = 'https://models.dev/api.json';
const protocols = {
  '@ai-sdk/openai-compatible': 'chat',
  '@ai-sdk/openai': 'responses',
  '@ai-sdk/anthropic': 'messages',
};

function isZero(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number(value) === 0;
}
function hasCharge(value) {
  if (value && typeof value === 'object') return Object.values(value).some(hasCharge);
  return (typeof value === 'number' || typeof value === 'string') && Number(value) > 0;
}

export function selectOpenCodeModels(catalogue, registry) {
  const provider = registry?.opencode;
  if (provider?.api !== OPENCODE_BASE || !provider.models || !Array.isArray(catalogue?.data)) return [];
  const seen = new Set();
  return catalogue.data.flatMap(entry => {
    const id = entry?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    const model = provider.models[id];
    const protocol = protocols[model?.provider?.npm || provider.npm];
    // Unknown prices, positive cache/tier prices, unsupported modalities and
    // retired models never become a free route by name or suffix alone.
    if (!model || !protocol || !isZero(model.cost?.input) || !isZero(model.cost?.output)
      || hasCharge(model.cost) || hasCharge(entry.pricing) || hasCharge(entry.cost)
      || !model.modalities?.output?.includes('text')
      || (model.provider?.api && model.provider.api.replace(/\/$/, '') !== OPENCODE_BASE)) return [];
    const contextLength = Number(model.limit?.context);
    const maxOutput = Number(model.limit?.output);
    return [{id, name: typeof model.name === 'string' ? model.name : id, provider: 'OpenCode Zen',
      verified: true, paid: false, protocol, requiresKey: true,
      ...(Number.isFinite(contextLength) && contextLength > 0 ? {contextLength} : {}),
      ...(Number.isFinite(maxOutput) && maxOutput > 0 ? {maxOutput} : {})}];
  });
}

export async function loadOpenCodeModels(fetcher = fetch, signal) {
  const results = await Promise.all([
    fetcher(OPENCODE_BASE + '/models', {redirect: 'error', signal}),
    fetcher(OPENCODE_METADATA, {redirect: 'error', signal}),
  ]);
  if (results.some(r => !r.ok)) throw new Error('OpenCode free model discovery is unavailable. Refresh later; no paid route will be substituted.');
  const [catalogue, registry] = await Promise.all(results.map(r => r.json()));
  return selectOpenCodeModels(catalogue, registry);
}

export function openCodeRequest(model, messages, temperature = 0.2) {
  const maxTokens = Math.min(4096, model.maxOutput || 4096);
  const common = {model: model.id, stream: true};
  if (model.protocol === 'responses') return {
    url: OPENCODE_BASE + '/responses',
    body: {...common, store: false, input: messages, max_output_tokens: maxTokens},
  };
  if (model.protocol === 'messages') return {
    url: OPENCODE_BASE + '/messages',
    body: {...common, max_tokens: maxTokens, temperature,
      system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
      messages: messages.filter(m => m.role !== 'system')},
  };
  return {url: OPENCODE_BASE + '/chat/completions', body: {...common, messages, max_tokens: maxTokens, temperature}};
}

function textBlocks(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(p => ['text', 'output_text'].includes(p?.type)).map(p => p.text || '').join('') : '';
}
function responseText(data, protocol) {
  if (protocol === 'responses') return typeof data.output_text === 'string' ? data.output_text
    : (data.output || []).filter(p => p.type === 'message').map(p => textBlocks(p.content)).join('');
  if (protocol === 'messages') return textBlocks(data.content);
  return textBlocks(data.choices?.[0]?.message?.content);
}
export function openCodeErrorMessage(data, status, key = '') {
  const raw = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
  const detail = typeof raw === 'string' ? raw.replaceAll(key || '\0', '[redacted]').slice(0, 500) : '';
  const advice = status === 401 ? 'Add a valid OpenCode Zen API key in Connections.'
    : status === 403 ? 'OpenCode denied this request. Check your key, workspace model access, and free-tier eligibility in OpenCode Console.'
    : status === 429 ? 'OpenCode has reached its usage limit. Wait for the provider reset or choose another connection.'
    : status === 404 ? 'This OpenCode model is no longer available. Refresh the model list.'
    : 'OpenCode could not complete the request. Try again or choose another model.';
  return detail ? advice + ' ' + detail : advice;
}

// Normalize the documented three text protocols. Never expose reasoning deltas
// as generated code, and never treat an HTTP-200 error event as a completion.
export async function readOpenCodeCompletion(response, protocol) {
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = await response.json();
    if (data.error || ['failed', 'incomplete'].includes(data.status)) throw new Error(openCodeErrorMessage(data, 502));
    if (data.choices?.[0]?.finish_reason === 'length' || data.stop_reason === 'max_tokens') throw new Error('OpenCode reached its output limit before finishing. Try a smaller task.');
    const content = responseText(data, protocol);
    if (!content.trim()) throw new Error('OpenCode returned no answer text. Choose another model or try again.');
    return content;
  }
  if (!response.body) throw new Error('OpenCode returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', completed = false;
  const consume = block => {
    const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) return;
    if (payload === '[DONE]') {completed = true; return;}
    let data;
    try {data = JSON.parse(payload)} catch {throw new Error('OpenCode returned an invalid stream event. Retry the request.');}
    if (data.error || ['error', 'response.failed', 'response.incomplete'].includes(data.type)
      || data.choices?.some(choice => choice.finish_reason === 'error')) throw new Error(openCodeErrorMessage(data.response || data, 502));
    if (data.choices?.[0]?.finish_reason === 'length' || data.delta?.stop_reason === 'max_tokens') throw new Error('OpenCode reached its output limit before finishing. Try a smaller task.');
    if (protocol === 'responses') {
      if (data.type === 'response.output_text.delta') content += data.delta || '';
      if (data.type === 'response.completed') {completed = true; if (!content) content = responseText(data.response || {}, protocol);}
    } else if (protocol === 'messages') {
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') content += data.delta.text || '';
      if (data.type === 'message_stop') completed = true;
    } else {
      content += textBlocks(data.choices?.[0]?.delta?.content);
      if (data.choices?.[0]?.finish_reason) completed = true;
    }
  };
  try {
    for (;;) {
      const {done, value} = await reader.read();
      buffer += decoder.decode(value, {stream: !done}).replace(/\r\n/g, '\n');
      // Normalize CRLF after concatenation too, including split chunk boundaries.
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {consume(buffer.slice(0, end)); buffer = buffer.slice(end + 2);}
      if (done) break;
      if (buffer.length > 2_000_000 || content.length > 2_000_000) throw new Error('OpenCode response is too large.');
    }
    if (buffer.trim()) consume(buffer);
  } catch (error) {await reader.cancel().catch(() => {}); throw error;}
  finally {reader.releaseLock();}
  if (!completed) throw new Error('OpenCode disconnected before the answer finished. Retry the request.');
  if (!content.trim()) throw new Error('OpenCode returned no answer text. Choose another model or try again.');
  return content;
}
