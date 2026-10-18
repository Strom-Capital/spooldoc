'use client';

import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from 'ai';
import { useEffect, useRef } from 'react';
import { SYNC_TOOLS, type ChatToolName } from '@/lib/chat-types';
import { savedFile } from '@/lib/client/chat';
import { useWorkbench } from './workbench-provider';

/**
 * Keep the workbench in step with the chat: when a write_definition or write_template
 * call finishes, fetch the job's draft again (the tool changed it on the server); after
 * any sync tool, render again, once per tool call. Reload again when a response ends.
 *
 * @param messages - The chat messages
 * @param status - The chat status
 */
export function useWorkbenchSync(messages: UIMessage[], status: ChatStatus): void {
  const { reload, onDraftWritten } = useWorkbench();
  const seen = useRef(new Set<string>());
  const previous = useRef<ChatStatus>(status);

  useEffect(() => {
    let changed = false;
    let written = false;
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== 'output-available' || seen.current.has(part.toolCallId)) continue;
        const toolName = getToolName(part);
        if (!SYNC_TOOLS.includes(toolName as ChatToolName)) continue;
        seen.current.add(part.toolCallId);
        const saved = savedFile({ toolName, state: part.state, output: part.output });
        if (saved) written = true;
        changed = true;
      }
    }
    if (written) void onDraftWritten();
    else if (changed) void reload();
  }, [messages, reload, onDraftWritten]);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if ((was === 'submitted' || was === 'streaming') && (status === 'ready' || status === 'error')) {
      void onDraftWritten();
    }
  }, [status, onDraftWritten]);
}
