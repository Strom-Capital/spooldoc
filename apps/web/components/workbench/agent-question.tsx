'use client';

import { CheckIcon } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Suggestion } from '@/components/ai-elements/suggestion';
import type { AskedQuestion } from '@/lib/client/chat';

/**
 * A question the agent asked with `ask_user`, with its answers as buttons. A click sends
 * the answer as the user's next message; the user can also type one. Once answered, the
 * buttons stay as they were, with the chosen one checked, and no longer send.
 *
 * @param answer - The user's answer, or null while there is none
 * @param busy - The chat is answering, so nothing can be sent
 * @param onAnswer - Sends an answer
 */
export function AgentQuestion({
  question,
  answer,
  busy,
  onAnswer,
}: {
  question: AskedQuestion;
  answer: string | null;
  busy: boolean;
  onAnswer: (answer: string) => void;
}) {
  const open = answer === null && !busy;
  const chosen = (label: string) => answer !== null && answer.toLowerCase() === label.trim().toLowerCase();
  return (
    <div role="group" aria-label="Question from the agent" className="flex flex-col gap-2">
      <MessageResponse>{question.question}</MessageResponse>
      {question.options.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          {question.options.map((option) => (
            <Suggestion
              key={option.label}
              suggestion={option.label.trim()}
              onClick={onAnswer}
              disabled={!open}
              variant={chosen(option.label) ? 'secondary' : 'outline'}
              className="h-auto flex-col items-start gap-0.5 whitespace-normal rounded-lg py-1.5 text-left"
            >
              <span className="flex items-center gap-1.5">
                {chosen(option.label) && <CheckIcon className="size-3.5" aria-label="Chosen" />}
                {option.label}
                {option.recommended && <span className="font-normal text-muted-foreground text-xs">Recommended</span>}
              </span>
              {option.description && <span className="font-normal text-muted-foreground text-xs">{option.description}</span>}
            </Suggestion>
          ))}
        </div>
      )}
      {open && (
        <p className="text-muted-foreground text-xs">
          {question.options.length > 0 ? 'Pick an answer, or type your own below.' : 'Type your answer below.'}
        </p>
      )}
    </div>
  );
}
