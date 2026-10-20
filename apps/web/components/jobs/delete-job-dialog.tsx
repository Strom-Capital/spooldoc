'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api, errorText } from '@/lib/client/api';

/** Asks before deleting a job, deletes it and says so. Open while `job` is set. */
export function DeleteJobDialog({
  job,
  onClose,
  onDeleted,
}: {
  job: { id: string; name: string } | null;
  onClose(): void;
  onDeleted(): void | Promise<void>;
}) {
  // The last job asked about, so the title keeps its name while the dialog closes.
  const [shown, setShown] = useState(job);
  if (job && job !== shown) setShown(job);

  async function remove(target: { id: string; name: string }) {
    try {
      await api(`/api/jobs/${target.id}`, { method: 'DELETE' });
    } catch (err) {
      toast.error(`Could not delete ${target.name}`, { description: errorText(err) });
      return;
    }
    toast.success(`Deleted ${target.name}`);
    await onDeleted();
  }

  return (
    <AlertDialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {shown?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The job, its versions, its runs and their files are deleted. Nothing changes on the IBM i.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => job && remove(job)}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
