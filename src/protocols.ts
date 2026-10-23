import { randomUUID } from 'node:crypto';

export function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
function text(value: any): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : v.text || '').join('\n');
  return value == null ? '' : JSON.stringify(value);
}
function content(value: any): any[] {
  if (value == null) return [];
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  if (!Array.isArray(value)) invalid('Content must be a string or array');
  return value.map(p => {
    if (['text', 'input_text', 'output_text'].includes(p.type)) return { type: 'text', text: String(p.text || '') };
    if (p.type === 'image' && p.source?.type === 'base64') return p;
    if (['image_url', 'input_image'].includes(p.type)) {
      const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
      if (!m) invalid('Images must use a supported base64 data URL; remote image downloads are not supported');
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    }
    if (['tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(p.type)) return p;
    invalid('Unsupported content type: ' + p.type);
  });
}
function parseArguments(value: any) { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { invalid('Tool arguments must contain valid JSON'); } }

export function normalize(format: string, body: any): any {
  if (!body || typeof body !== 'object' || !body.model) invalid('model is required');
  const model = String(body.model).replace(/^zcode\//, '').toLowerCase();
  if (!/^glm-[a-z0-9.\-]+$/.test(model)) invalid('Unsupported model identifier');
  const result: any = { model, max_tokens: body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? 8192, messages: [] };
  if (!Number.isInteger(result.max_tokens) || result.max_tokens < 1 || result.max_tokens > 128000) invalid('Invalid output token limit');
  if (format === 'messages') {
    if (!Array.isArray(body.messages)) invalid('messages must be an array');
    result.system = text(body.system);
    result.messages = body.messages.map(m => {
      if (!['user', 'assistant'].includes(m.role)) invalid('Unsupported message role');
      return { role: m.role, content: content(m.content) };
    });
  } else {
    const input = format === 'responses' ? (typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input) : body.messages;
    if (!Array.isArray(input)) invalid('Input must contain a conversation');
    const system = body.instructions ? [String(body.instructions)] : [];
    for (const m of input) {
      if (['system', 'developer'].includes(m.role)) { system.push(text(m.content)); continue; }
      if (m.type === 'function_call') {
        result.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: m.call_id || m.id, name: m.name, input: parseArguments(m.arguments) }] }); continue;
      }
      if (m.role === 'tool' || m.type === 'function_call_output') {
        result.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || m.call_id, content: text(m.content ?? m.output) }] }); continue;
      }
      if (m.type === 'reasoning') continue;
      if (!['user', 'assistant'].includes(m.role)) invalid('Unsupported message role');
      const blocks = content(m.content);
      for (const call of m.tool_calls || []) {
        if (call.type !== 'function' || !call.id || !call.function?.name) invalid('Invalid function call');
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) });
      }
      result.messages.push({ role: m.role, content: blocks });
    }
    result.system = system.join('\n\n');
  }
  if (!result.messages.length) invalid('At least one non-system message is required');
  // Adjacent tool result messages belong to one Anthropic user turn.
  result.messages = result.messages.reduce((all, m) => {
    const last = all.at(-1);
    if (last?.role === m.role) last.content.push(...m.content); else all.push(m);
    return all;
  }, []);
  const callIds = new Set<string>();
  for (const m of result.messages) for (const c of m.content) {
    if (c.type === 'tool_use') { if (!c.id || !c.name) invalid('Invalid tool use'); callIds.add(c.id); }
    if (c.type === 'tool_result' && !callIds.has(c.tool_use_id)) invalid('Tool result has no matching earlier tool call');
  }
  if (body.tools?.length && body.tool_choice !== 'none') {
    result.tools = body.tools.map(t => {
      const f = format === 'messages' ? t : format === 'responses' ? t : t.function;
      if (format !== 'messages' && t.type !== 'function') invalid('Unsupported hosted tool: ' + t.type);
      if (!f?.name) invalid('Function name is required');
      return { name: f.name, ...(f.description ? { description: f.description } : {}), input_schema: f.input_schema || f.parameters || { type: 'object', properties: {} } };
    });
  }
  if (result.tools?.length && body.tool_choice) {
    const t = body.tool_choice;
    result.tool_choice = typeof t === 'string' ? { type: t === 'required' ? 'any' : t } : t.type === 'function' ? { type: 'tool', name: t.name || t.function?.name } : t;
  }
  if (body.parallel_tool_calls === false && result.tools) result.tool_choice = { ...(result.tool_choice || { type: 'auto' }), disable_parallel_tool_use: true };
  if (body.reasoning_effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(body.reasoning_effort)) invalid('Unsupported reasoning effort');
  if (body.reasoning_effort === 'none' || body.thinking?.type === 'disabled') invalid('GLM-5.3 always reasons; disabling thinking is unsupported');
  if (body.reasoning_effort) result.output_config = { effort: ['minimal','low','medium'].includes(body.reasoning_effort) ? 'low' : ['xhigh','max'].includes(body.reasoning_effort) ? 'max' : 'high' };
  if (body.thinking && body.thinking.type !== 'disabled') result.thinking = body.thinking;
  if (body.stop || body.stop_sequences) result.stop_sequences = typeof body.stop === 'string' ? [body.stop] : body.stop_sequences || body.stop;
  return result;
}

export function usage(u: any = {}) {
  const input = Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
  const output = Number(u.output_tokens || 0);
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_tokens_details: { cached_tokens: Number(u.cache_read_input_tokens || 0) } };
}
export function toChat(r: any) {
  const blocks = r.content || [], calls = blocks.filter(c => c.type === 'tool_use');
  const message: any = { role: 'assistant', content: blocks.filter(c => c.type === 'text').map(c => c.text).join('') || null };
  const reasoning = blocks.filter(c => c.type === 'thinking').map(c => c.thinking).join('');
  if (reasoning) message.reasoning_content = reasoning;
  if (calls.length) message.tool_calls = calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } }));
  return { id: r.id || 'chatcmpl_' + randomUUID(), object: 'chat.completion', created: Math.floor(Date.now()/1000), model: r.model, choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : r.stop_reason === 'max_tokens' ? 'length' : 'stop' }], usage: usage(r.usage) };
}
export function toResponses(r: any, id = 'resp_' + randomUUID()) {
  const output: any[] = [];
  for (const [i,c] of (r.content || []).entries()) {
    if (c.type === 'text') output.push({ id: 'msg_' + id + '_' + i, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: c.text, annotations: [] }] });
    if (c.type === 'tool_use') output.push({ id: 'fc_' + id + '_' + i, type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input), status: 'completed' });
    if (c.type === 'thinking') output.push({ id: 'rs_' + id + '_' + i, type: 'reasoning', summary: [{ type: 'summary_text', text: c.thinking }] });
  }
  const u = usage(r.usage);
  return { id, object: 'response', created_at: Math.floor(Date.now()/1000), model: r.model, status: r.stop_reason === 'max_tokens' ? 'incomplete' : 'completed', error: null, incomplete_details: r.stop_reason === 'max_tokens' ? { reason: 'max_output_tokens' } : null, output, output_text: output.filter(x=>x.type==='message').map(x=>x.content[0].text).join(''), usage: { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, total_tokens: u.total_tokens, input_tokens_details: u.prompt_tokens_details }, parallel_tool_calls: true, tool_choice: 'auto', tools: [] };
}
