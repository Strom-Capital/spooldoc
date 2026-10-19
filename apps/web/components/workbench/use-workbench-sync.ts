'use client';

import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from 'ai';
import { useEffect, useRef } from 'react';
import { SYNC_TOOLS, type ChatToolName } from '@/lib/chat-types';
import { savedFile, writtenTemplate } from '@/lib/client/chat';
import { useWorkbench } from './workbench-provider';

/**
 * Keep the workbench in step with the chat: when a write_definition or write_template
 * call finishes, fetch the job's draft again (the tool changed it on the server); after
 * any sync tool, render again, once per tool call. When a call wrote or added a template,
 * open that template, so the user sees what changed. Reload again when a response ends.
 * The tool calls of the stored thread, there when the chat mounts, are already in the
 * draft the workbench loaded, so they trigger nothing.
 *
 * @param messages - The chat messages
 * @param status - The chat status
 */
export function useWorkbenchSync(messages: UIMessage[], status: ChatStatus): void {
  const { reload, onDraftWritten, setTemplateId } = useWorkbench();
  const seen = useRef<Set<string> | null>(null);
  const previous = useRef<ChatStatus>(status);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(messages.flatMap((message) => message.parts.filter(isToolUIPart).map((part) => part.toolCallId)));
      return;
    }
    let changed = false;
    let written = false;
    let opened: string | null = null;
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== 'output-available' || seen.current.has(part.toolCallId)) continue;
        const toolName = getToolName(part);
        if (!SYNC_TOOLS.includes(toolName as ChatToolName)) continue;
        seen.current.add(part.toolCallId);
        const saved = savedFile({ toolName, state: part.state, output: part.output });
        if (saved) written = true;
        opened = writtenTemplate({ toolName, state: part.state, output: part.output }) ?? opened;
        changed = true;
      }
    }
    // Opened after the draft is read again, so a template added a moment ago is there.
    if (written) void onDraftWritten().then(() => opened && setTemplateId(opened));
    else if (changed) void reload();
  }, [messages, reload, onDraftWritten, setTemplateId]);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if ((was === 'submitted' || was === 'streaming') && (status === 'ready' || status === 'error')) {
      void onDraftWritten();
    }
  }, [status, onDraftWritten]);
}
