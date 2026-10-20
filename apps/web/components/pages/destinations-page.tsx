'use client';

import { DownloadIcon, FolderIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, Loading } from '@/components/empty-state';
import { JobsPopover } from '@/components/jobs-popover';
import { ErrorNote, Page } from '@/components/page';
import { ActionsCell, ActionsHead, RowAction, RowMenu, RowOpenButton, useRowOpen } from '@/components/row-actions';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { api, errorText } from '@/lib/client/api';
import { destinationText } from '@/lib/destination-config';
import type { DestinationView } from '@/lib/types';
import { DestinationDialog } from './destination-dialog';

type IfsDestination = Extract<DestinationView, { kind: 'ifs' }>;

const KIND_ICON = { spooldoc: DownloadIcon, ifs: FolderIcon };

/** The destinations jobs can deliver to, with the jobs that use each, and add, edit and delete. */
export function DestinationsPage() {
  const [destinations, setDestinations] = useState<DestinationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<IfsDestination | 'new' | null>(null);
  const [deleting, setDeleting] = useState<IfsDestination | null>(null);
  const rowOpen = useRowOpen();

  const load = useCallback(async () => {
    try {
      setDestinations((await api<{ destinations: DestinationView[] }>('/api/destinations')).destinations);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    api<{ destinations: DestinationView[] }>('/api/destinations').then(
      (data) => setDestinations(data.destinations),
      (err) => setError(errorText(err)),
    );
  }, []);

  async function remove(destination: IfsDestination) {
    try {
      await api(`/api/destinations/${destination.id}`, { method: 'DELETE' });
      setDeleting(null);
      toast.success(`Deleted ${destination.name}`);
      await load();
    } catch (err) {
      setDeleting(null);
      toast.error(`Could not delete ${destination.name}`, { description: errorText(err) });
    }
  }

  return (
    <Page
      title="Destinations"
      description="Where jobs deliver their documents."
      actions={
        <Button onClick={() => setEditing('new')}>
          <PlusIcon />
          Add destination
        </Button>
      }
    >
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {destinations === null && !error && <Loading>Loading destinations...</Loading>}
      {destinations?.length === 0 && (
        <EmptyState icon={SendIcon} title="No destinations yet" description="Add a folder in the IFS for jobs to write their documents to.">
          <Button onClick={() => setEditing('new')}>
            <PlusIcon />
            Add destination
          </Button>
        </EmptyState>
      )}
      {destinations && destinations.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Destination</th>
                <th className="px-3 py-2 font-medium">Where the files go</th>
                <th className="px-3 py-2 text-right font-medium">Jobs</th>
                <ActionsHead />
              </tr>
            </thead>
            <tbody>
              {destinations.map((destination) => {
                const Icon = KIND_ICON[destination.kind];
                const text = destinationText(destination);
                const ifs = destination.kind === 'ifs' ? destination : null;
                return (
                  <tr key={destination.id} {...(ifs ? rowOpen(() => setEditing(ifs), 'border-t align-top') : { className: 'border-t align-top' })}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                        {ifs ? <RowOpenButton onClick={() => setEditing(ifs)}>{ifs.name}</RowOpenButton> : <span className="font-medium">{destination.name}</span>}
                        {destination.builtin && <Badge variant="secondary">Built in</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {ifs ? (
                        <div className="font-mono text-xs">{ifs.config.folder}</div>
                      ) : (
                        <div>{text.where}</div>
                      )}
                      <div className="text-muted-foreground text-xs">{ifs ? `On the job's server. ${text.how}` : text.how}</div>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">
                      <JobsPopover
                        jobs={destination.jobs}
                        label={`${destination.jobs.length} ${destination.jobs.length === 1 ? 'job delivers' : 'jobs deliver'} to ${destination.name}`}
                        heading="Jobs that deliver here"
                      />
                    </td>
                    <ActionsCell>
                      {ifs && (
                        <>
                          <RowAction onClick={() => setEditing(ifs)}>
                            <PencilIcon />
                            Edit
                          </RowAction>
                          <RowMenu label={ifs.name}>
                            <DropdownMenuItem onSelect={() => setEditing(ifs)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(ifs)}>
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </RowMenu>
                        </>
                      )}
                    </ActionsCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DestinationDialog
          destination={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            toast.success(editing === 'new' ? `Added ${saved.name}` : `Saved ${saved.name}`);
            setEditing(null);
            await load();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Spooldoc forgets the destination. The folder and the files in it stay on the IBM i. A destination that jobs deliver to cannot be
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && remove(deleting)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
