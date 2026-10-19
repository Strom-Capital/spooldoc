import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { hasContent, trimHistory } from '@/lib/server/chat';

const user = (id: string, text = `Question ${id}`): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });

/** An answer with one write_definition call whose result is `size` characters, then a line of text. */
function answer(id: string, size = 10): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'tool-write_definition', toolCallId: `call-${id}`, state: 'output-available', input: { yaml: 'type: x' }, output: { ok: true, preview: 'x'.repeat(size) } },
      { type: 'step-start' },
      { type: 'text', text: `Answer ${id}`, state: 'done' },
    ] as UIMessage['parts'],
  };
}

/** An answer from a model that thinks: each step a signed reasoning part, then a write_definition call; then text. */
function thinkingAnswer(id: string, size = 10): UIMessage {
  const signed = (text: string) => ({ type: 'reasoning', text, state: 'done', providerMetadata: { anthropic: { signature: `sig-${id}-${text}` } } });
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      signed('first'),
      { type: 'tool-write_definition', toolCallId: `call-${id}`, state: 'output-available', input: { yaml: 'type: x' }, output: { ok: true, preview: 'x'.repeat(size) } },
      { type: 'step-start' },
      signed('second'),
      { type: 'text', text: `Answer ${id}`, state: 'done' },
    ] as UIMessage['parts'],
  };
}

const ids = (messages: UIMessage[]): string[] => messages.map((m) => m.id);
const toolParts = (message: UIMessage): number => message.parts.filter((p) => p.type.startsWith('tool-')).length;

describe('trimHistory', () => {
  it('keeps a short thread as it is', () => {
    const thread = [user('u1'), answer('a1'), user('u2')];
    expect(trimHistory(thread)).toEqual(thread);
  });

  it('keeps the newest messages, starting with a user message', () => {
    const thread: UIMessage[] = [];
    for (let i = 1; i <= 13; i++) {
      thread.push(user(`u${i}`), answer(`a${i}`));
    }
    thread.push(user('u14'));
    const kept = trimHistory(thread);
    // The last 20 would start with a13's answer a4; the thread starts at the user's turn after it.
    expect(kept).toHaveLength(19);
    expect(kept[0]?.id).toBe('u5');
    expect(kept.at(-1)?.id).toBe('u14');
    expect(ids(trimHistory(thread, { maxMessages: 4 }))).toEqual(['u13', 'a13', 'u14']);
  });

  it('drops the oldest tool results first when over the character budget, keeping the words around them', () => {
    const thread = [user('u1'), answer('a1', 30_000), user('u2'), answer('a2', 30_000), user('u3')];
    const kept = trimHistory(thread, { maxChars: 50_000 });
    expect(ids(kept)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
    expect(toolParts(kept[1]!)).toBe(0);
    expect(kept[1]?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Answer a1' }));
    expect(toolParts(kept[3]!)).toBe(1);
    // The thread given is not changed.
    expect(toolParts(thread[1]!)).toBe(1);
  });

  it('drops the reasoning of an answer with its tool results, and leaves a newer answer as it was', () => {
    // Signed thinking without the tool calls it was made with is turned down by Anthropic.
    const thread = [user('u1'), thinkingAnswer('a1', 30_000), user('u2'), thinkingAnswer('a2', 30_000), user('u3')];
    const kept = trimHistory(thread, { maxChars: 50_000 });
    expect(ids(kept)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
    expect(kept[1]?.parts.map((p) => p.type)).toEqual(['step-start', 'step-start', 'text']);
    expect(kept[3]).toEqual(thread[3]);
  });

  it('then drops whole messages from the oldest, never the last one', () => {
    // Without tool results the thread is 2 000 characters of u1 and a few hundred of the rest.
    const thread = [user('u1', 'x'.repeat(2_000)), answer('a1', 30_000), user('u2'), answer('a2', 30_000), user('u3')];
    expect(ids(trimHistory(thread, { maxChars: 1_500 }))).toEqual(['u2', 'a2', 'u3']);
    expect(ids(trimHistory(thread, { maxChars: 10 }))).toEqual(['u3']);
    expect(ids(trimHistory([user('u1', 'x'.repeat(100))], { maxChars: 10 }))).toEqual(['u1']);
  });

  it('leaves out messages that say nothing, and an answer that was only a tool call once that is dropped', () => {
    const empty: UIMessage = { id: 'e', role: 'assistant', parts: [] };
    const blank: UIMessage = { id: 'b', role: 'assistant', parts: [{ type: 'text', text: '  ' }] };
    const toolOnly: UIMessage = { id: 't', role: 'assistant', parts: answer('t', 30_000).parts.filter((p) => p.type !== 'text') };
    expect(hasContent(empty)).toBe(false);
    expect(hasContent(blank)).toBe(false);
    expect(hasContent(toolOnly)).toBe(true);
    expect(hasContent(user('u'))).toBe(true);

    expect(ids(trimHistory([user('u1'), empty, blank, user('u2')]))).toEqual(['u1', 'u2']);
    expect(ids(trimHistory([user('u1'), toolOnly, user('u2'), answer('a2', 30_000), user('u3')], { maxChars: 50_000 }))).toEqual(['u1', 'u2', 'a2', 'u3']);
  });
});
