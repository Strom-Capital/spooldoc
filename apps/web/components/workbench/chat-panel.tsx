'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, type UIMessage } from 'ai';
import { EyeOffIcon, EyeIcon, MessageSquarePlusIcon } from 'lucide-react';
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
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion } from '@/components/ai-elements/suggestion';
import { useAppInfo } from '@/components/app-info';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort } from '@/lib/client/api';
import { chatActivity, chatErrorText } from '@/lib/client/chat';
import { ToolSummary } from './tool-summary';
import { useWorkbenchSync } from './use-workbench-sync';
import { useWorkbench } from './workbench-provider';

const SUGGESTIONS = [
  'Generate a definition and a template from this spooled file',
  'This is a multi-document run, split it per document',
  'The first page is a parameter page, skip it',
  'Make the template match the printed layout',
];

/**
 * The AI chat for the job's preview spooled file. The model proposes a definition and a
 * template, writes them to the job's draft through tools and checks the extraction
 * report; the workbench reloads as it goes. The thread is kept with the job: it comes
 * back after a reload, and New chat clears it. Without a configured model it shows how
 * to set one up.
 *
 * @param header - Controls for the pane header (the Preview and Chat tabs)
 */
export function ChatPanel({ header }: { header?: ReactNode }) {
  const session = useAppInfo();
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Chat">
      {session.model ? (
        <ChatConversation modelId={session.model.id} header={header} />
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

/** The pane header: the given controls, the masking badge and any extra controls. */
function PanelHeader({ header, children }: { header?: ReactNode; children?: ReactNode }) {
  const session = useAppInfo();
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 text-sm">
      {header ?? <span className="font-medium">Chat</span>}
      <Badge
        variant="secondary"
        className="ml-auto gap-1 font-normal"
        title={session.masking ? 'Digits and letters of values are masked before page text goes to the model (SPOOLDOC_MASK).' : 'Page text goes to the model as printed (SPOOLDOC_MASK=false).'}
      >
        {session.masking ? <EyeOffIcon /> : <EyeIcon />}
        {session.masking ? 'Values masked' : 'Values sent in clear'}
      </Badge>
      {children}
    </div>
  );
}

/** Load the job's stored thread, then show the conversation with it. */
function ChatConversation({ modelId, header }: { modelId: string; header?: ReactNode }) {
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
  return <ChatThread modelId={modelId} jobId={jobId} header={header} initial={stored.messages} initialNotice={stored.notice} />;
}

/** The conversation, starting from the stored thread. */
function ChatThread({
  modelId,
  jobId,
  header,
  initial,
  initialNotice,
}: {
  modelId: string;
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
                  Ask the model to propose a definition and a template. It writes them to the job&apos;s draft, reads
                  the extraction report and fixes what is missing.
                </p>
                <div className="flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <Suggestion key={suggestion} suggestion={suggestion} onClick={send} className="h-auto whitespace-normal py-1.5 text-left" />
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
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
                      return <ToolSummary key={part.toolCallId} part={part} />;
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
                placeholder="Describe the document or ask for a change"
                aria-label="Message"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools className="min-w-0 truncate text-muted-foreground text-xs">{modelId}</PromptInputTools>
              <PromptInputSubmit status={status} onStop={() => void stop()} disabled={!busy && !draft.trim()} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
}
