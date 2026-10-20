'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai';
import { MessageSquarePlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { useAppInfo } from '@/components/app-info';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort } from '@/lib/client/api';
import { askedQuestion, chatActivity, chatErrorText, questionAnswer } from '@/lib/client/chat';
import { usageText } from '@/lib/client/format';
import type { UsageTotals } from '@/lib/types';
import { AgentQuestion } from './agent-question';
import { ToolSummary } from './tool-summary';
import { useWorkbenchSync } from './use-workbench-sync';
import { useWorkbench } from './workbench-provider';

const SUGGESTIONS = ['Generate a definition and a template from this spooled file'];

/**
 * The agent for the job's preview spooled file. The model proposes a definition and a
 * template, writes them to the job's draft through tools and checks the extraction
 * report; the workbench reloads as it goes. The thread is kept with the job: it comes
 * back after a reload, and New chat clears it. Without a configured model it shows how
 * to set one up.
 *
 * @param header - Controls for the pane header (the Agent title)
 */
export function ChatPanel({ header }: { header?: ReactNode }) {
  const session = useAppInfo();
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Agent">
      {session.model ? (
        <ChatConversation header={header} />
      ) : (
        <>
          <PanelHeader header={header} />
          <p role="note" className="m-3 rounded-md border bg-muted/40 p-3 text-muted-foreground text-sm">
            No model set up. Choose a provider and model in{' '}
            <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
              Settings
            </Link>
            .
          </p>
        </>
      )}
    </section>
  );
}

/** The pane header: the given controls, then any extra controls on the right. */
function PanelHeader({ header, children }: { header?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 text-sm">
      {header ?? <span className="font-medium">Agent</span>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Load the job's stored thread, then show the conversation with it. */
function ChatConversation({ header }: { header?: ReactNode }) {
  const { jobId } = useWorkbench();
  const [stored, setStored] = useState<{ messages: UIMessage[]; notice: string | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<{ messages: UIMessage[] }>(`/api/jobs/${jobId}/chat`, { signal: controller.signal })
      .then((data) => setStored({ messages: data.messages, notice: null }))
      .catch((error: unknown) => {
        if (!isAbort(error)) setStored({ messages: [], notice: `The earlier conversation could not be loaded: ${errorText(error)}` });
      });
    return () => controller.abort();
  }, [jobId]);

  if (!stored) {
    return (
      <>
        <PanelHeader header={header} />
        <div role="status" aria-live="polite" className="flex items-center gap-2 p-3 text-muted-foreground text-sm">
          <Spinner className="size-3.5" />
          Loading the conversation
        </div>
      </>
    );
  }
  return <ChatThread jobId={jobId} header={header} initial={stored.messages} initialNotice={stored.notice} />;
}

/**
 * This chat's usage as a line, such as "This chat: 84K tokens in, 2.1K out, $0.12". It
 * loads with the panel and again after each answer. New chat calls `reset`, so the
 * last chat's total does not show while the first answer of the next one runs.
 *
 * @param busy - An answer is running; the usage loads again when it ends
 * @param empty - The thread has no messages (a new chat), so there is nothing to count
 */
function useChatUsage(jobId: string, busy: boolean, empty: boolean): { text: string | null; reset(): void } {
  const [usage, setUsage] = useState<{ text: string | null } | null>(null);

  useEffect(() => {
    if (busy || empty) return;
    const controller = new AbortController();
    api<UsageTotals>(`/api/jobs/${jobId}/chat/usage`, { signal: controller.signal }).then(
      (totals) => setUsage({ text: totals.steps > 0 ? `This chat: ${usageText(totals)}` : null }),
      (error: unknown) => {
        if (!isAbort(error)) setUsage({ text: `Could not load this chat's usage: ${errorText(error)}` });
      },
    );
    return () => controller.abort();
  }, [jobId, busy, empty]);

  return { text: empty ? null : (usage?.text ?? null), reset: () => setUsage(null) };
}

/** The conversation, starting from the stored thread. */
function ChatThread({
  jobId,
  header,
  initial,
  initialNotice,
}: {
  jobId: string;
  header?: ReactNode;
  initial: UIMessage[];
  initialNotice: string | null;
}) {
  const [transport] = useState(() => new DefaultChatTransport({ api: `/api/jobs/${jobId}/chat` }));
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({ transport, messages: initial });
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  const [clearing, setClearing] = useState(false);
  const busy = status === 'submitted' || status === 'streaming';
  const activity = chatActivity(messages, status);
  useWorkbenchSync(messages, status);
  const usage = useChatUsage(jobId, busy, messages.length === 0);

  function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setDraft('');
    clearError();
    void sendMessage({ text: question });
  }

  /** Forget the thread on the server and on screen. Not while an answer runs: it is stored when it ends. */
  async function newChat() {
    if (busy || clearing) return;
    setClearing(true);
    try {
      await api(`/api/jobs/${jobId}/chat`, { method: 'DELETE' });
      setMessages([]);
      usage.reset();
      clearError();
      setNotice(null);
    } catch (error) {
      setNotice(`The conversation could not be cleared: ${errorText(error)}`);
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <PanelHeader header={header}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void newChat()}
          disabled={busy || clearing || messages.length === 0}
          title="Forget this conversation and start another. The definition and template stay."
        >
          <MessageSquarePlusIcon />
          New chat
        </Button>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <Conversation className="min-h-0">
          <ConversationContent className="gap-4 p-3">
            {messages.length === 0 && (
              <div className="flex flex-col gap-3 pt-2">
                <p className="text-muted-foreground text-sm">
                  Ask the agent to propose a definition and a template for the selected spooled file. It writes them
                  to the job&apos;s draft, checks what it extracted and fixes what is missing.
                </p>
                <div className="flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <Suggestion key={suggestion} suggestion={suggestion} onClick={send} className="h-auto whitespace-normal py-1.5 text-left" />
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, messageIndex) => (
              <Message key={message.id} from={message.role} className={message.role === 'assistant' ? 'max-w-full' : undefined}>
                <MessageContent className={message.role === 'assistant' ? 'w-full' : undefined}>
                  {message.parts.map((part, index) => {
                    if (part.type === 'text') {
                      return message.role === 'user' ? (
                        <p key={index} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      ) : (
                        <MessageResponse key={index} isAnimating={busy && message.id === messages.at(-1)?.id}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (part.type === 'reasoning' && part.text.trim()) {
                      return (
                        <Reasoning key={index} isStreaming={busy && part.state === 'streaming'}>
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }
                    if (isToolUIPart(part)) {
                      const question = askedQuestion({ toolName: getToolName(part), state: part.state, input: part.input, output: part.output });
                      return question ? (
                        <AgentQuestion key={part.toolCallId} question={question} answer={questionAnswer(messages, messageIndex)} busy={busy} onAnswer={send} />
                      ) : (
                        <ToolSummary key={part.toolCallId} part={part} />
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))}
            {activity && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 px-1 text-muted-foreground text-sm">
                <Spinner className="size-3.5" />
                <Shimmer className="text-sm" duration={1.5}>{`${activity}...`}</Shimmer>
              </div>
            )}
            {notice && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <p className="min-w-0 flex-1 break-words text-destructive">{notice}</p>
                <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
                  Dismiss
                </Button>
              </div>
            )}
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <p className="min-w-0 flex-1 break-words text-destructive">{chatErrorText(error)}</p>
                <Button variant="ghost" size="sm" onClick={() => clearError()}>
                  Dismiss
                </Button>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="shrink-0 p-2">
          <PromptInput onSubmit={(message) => send(message.text)} className="bg-card">
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask for a definition, a template or a change"
                aria-label="Message"
              />
            </PromptInputBody>
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} onStop={() => void stop()} disabled={!busy && !draft.trim()} />
            </PromptInputFooter>
          </PromptInput>
          {usage.text && <p className="px-1 pt-1.5 text-muted-foreground text-xs tabular-nums">{usage.text}</p>}
        </div>
      </div>
    </>
  );
}
