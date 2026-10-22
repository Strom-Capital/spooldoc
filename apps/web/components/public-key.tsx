'use client';

import { CopyIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * A public key Spooldoc made, with a Copy button and what to do with it: the one Carbone
 * checks requests with, or the one an SFTP server lets Spooldoc sign in with. The private
 * key never leaves the server.
 */
export function PublicKey({ id, value, label, help, actions, className }: { id: string; value: string; label: ReactNode; help: ReactNode; actions?: ReactNode; className?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied the public key');
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  }
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <pre id={id} tabIndex={0} className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
        {value}
      </pre>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex flex-1 flex-col items-start gap-1 text-muted-foreground text-xs">
          <p>{help}</p>
          {actions}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          <CopyIcon />
          Copy
        </Button>
      </div>
    </div>
  );
}
