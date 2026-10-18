import { ArrowRightIcon, CheckCircle2Icon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardView } from '@/lib/types';

const STEPS: { key: keyof DashboardView['setup']; title: string; text: string; href: string; action: string }[] = [
  { key: 'server', title: 'Add a server', text: 'Connect to an IBM i and test the connection.', href: '/servers', action: 'Servers' },
  { key: 'ai', title: 'Choose an AI provider', text: 'The chat proposes definitions and templates from a sample spooled file.', href: '/settings', action: 'Settings' },
  { key: 'job', title: 'Create a job', text: 'Pick an output queue and turn its spooled files into documents.', href: '/jobs', action: 'Jobs' },
  { key: 'run', title: 'Run it', text: 'Run the job on a file, or activate a version and let it watch the queue.', href: '/jobs', action: 'Jobs' },
];

/** The setup steps in order, with the next open one highlighted. Hidden once every step is done. */
export function GettingStarted({ setup }: { setup: DashboardView['setup'] }) {
  const next = STEPS.find((step) => !setup[step.key]);
  if (!next) return null;
  const done = STEPS.filter((step) => setup[step.key]).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Getting started</CardTitle>
        <CardDescription>
          {done} of {STEPS.length} steps done
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 md:grid-cols-4">
          {STEPS.map((step, index) => {
            const isDone = setup[step.key];
            const isNext = step === next;
            return (
              <li key={step.key} className={`flex flex-col gap-2 rounded-lg border p-3 ${isNext ? 'border-primary/50 bg-primary/5' : ''}`}>
                <div className="flex items-center gap-2 font-medium">
                  {isDone ? (
                    <CheckCircle2Icon className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-label="Done" />
                  ) : (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-muted-foreground text-xs">{index + 1}</span>
                  )}
                  <span className={isDone ? 'text-muted-foreground' : ''}>{step.title}</span>
                </div>
                <p className="flex-1 text-muted-foreground text-xs">{step.text}</p>
                {!isDone && (
                  <Button asChild size="sm" variant={isNext ? 'default' : 'outline'} className="self-start">
                    <Link href={step.href}>
                      {step.action}
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
