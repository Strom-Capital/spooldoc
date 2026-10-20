import { ArrowRightIcon, CheckCircle2Icon } from 'lucide-react';
import Link from 'next/link';
import { useAppInfo } from '@/components/app-info';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardView } from '@/lib/types';

type Setup = DashboardView['setup'] & { rendering: boolean };

const STEPS: { key: keyof Setup; title: string; text: string; href: string; action: string }[] = [
  {
    key: 'rendering',
    title: 'Connect Carbone',
    text: 'Spooldoc renders every document with Carbone. Start the Carbone service with Spooldoc\'s public key, or use Carbone Cloud.',
    href: '/settings#rendering',
    action: 'Settings',
  },
  { key: 'server', title: 'Add a server', text: 'Connect to an IBM i and test the connection.', href: '/servers', action: 'Servers' },
  { key: 'ai', title: 'Set up the agent', text: 'The agent proposes definitions and templates from a sample spooled file.', href: '/settings', action: 'Settings' },
  { key: 'job', title: 'Create a job', text: 'Pick an output queue and turn its spooled files into documents.', href: '/jobs', action: 'Jobs' },
  { key: 'run', title: 'Run it', text: 'Run the job on a file, or activate a version and let it watch the queue.', href: '/jobs', action: 'Jobs' },
];

/**
 * The setup steps in order, with the next open one highlighted. Hidden once every step is
 * done; it comes back when Carbone stops working, since nothing else says so before a run
 * fails.
 */
export function GettingStarted({ setup: dashboard }: { setup: DashboardView['setup'] }) {
  const setup: Setup = { ...dashboard, rendering: useAppInfo().rendering };
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
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                    <Link href={step.href} {...(step.href.startsWith('https:') ? { target: '_blank', rel: 'noreferrer' } : {})}>
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
