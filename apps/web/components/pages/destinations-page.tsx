'use client';

import { DownloadIcon, FlaskConicalIcon, FolderIcon, HardDriveUploadIcon, MailIcon, PencilIcon, PlusIcon, SendIcon, ShieldAlertIcon, Trash2Icon, WebhookIcon } from 'lucide-react';
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
import { destinationText, sftpTarget } from '@/lib/destination-config';
import type { DestinationView } from '@/lib/types';
import { DestinationDialog, type EditableDestination } from './destination-dialog';

const KIND_ICON = { spooldoc: DownloadIcon, ifs: FolderIcon, email: MailIcon, webhook: WebhookIcon, sftp: HardDriveUploadIcon };

/** The destinations jobs can deliver to, with the jobs that use each, and add, edit and delete. */
export function DestinationsPage() {
  const [destinations, setDestinations] = useState<DestinationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableDestination | 'new' | null>(null);
  const [deleting, setDeleting] = useState<EditableDestination | null>(null);
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

  async function remove(destination: EditableDestination) {
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
        <EmptyState icon={SendIcon} title="No destinations yet" description="Add a folder in the IFS, email, a webhook or an SFTP server, for jobs to deliver their documents to.">
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
                // Every destination but the built-in one can be edited.
                const editable = destination.builtin || destination.kind === 'spooldoc' ? null : destination;
                return (
                  <tr key={destination.id} {...(editable ? rowOpen(() => setEditing(editable), 'border-t align-top') : { className: 'border-t align-top' })}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                        {editable ? <RowOpenButton onClick={() => setEditing(editable)}>{editable.name}</RowOpenButton> : <span className="font-medium">{destination.name}</span>}
                        {destination.builtin && <Badge variant="secondary">Built in</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {destination.kind === 'sftp' ? (
                        <>
                          <div className="break-all font-mono text-xs">{sftpTarget(destination.config)}</div>
                          <div className="text-muted-foreground text-xs">
                            {destination.config.port !== 22 && `Port ${destination.config.port}. `}
                            {text.how}
                          </div>
                          {text.test && (
                            <div className="flex items-center gap-1 text-amber-700 text-xs dark:text-amber-400">
                              <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
                              <span className="min-w-0 break-words">{text.test}</span>
                            </div>
                          )}
                          {!destination.config.hostKey && (
                            <div className="flex items-center gap-1 text-amber-700 text-xs dark:text-amber-400">
                              <ShieldAlertIcon className="size-3.5 shrink-0" aria-hidden />
                              <span className="min-w-0 break-words">Host key not trusted yet. Open it and check the connection.</span>
                            </div>
                          )}
                        </>
                      ) : destination.kind === 'ifs' ? (
                        <>
                          <div className="font-mono text-xs">{destination.config.folder}</div>
                          <div className="text-muted-foreground text-xs">On the job&apos;s server. {text.how}</div>
                        </>
                      ) : (destination.kind === 'email' && destination.config.testAddress) || (destination.kind === 'webhook' && destination.config.testUrl) ? (
                        <>
                          <div>{text.where}</div>
                          <div className="flex items-center gap-1 text-amber-700 text-xs dark:text-amber-400">
                            <FlaskConicalIcon className="size-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 break-words">{text.how}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>{text.where}</div>
                          <div className="text-muted-foreground text-xs">{text.how}</div>
                        </>
                      )}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">
                      <JobsPopover
                        jobs={destination.jobs}
                        label={`${destination.jobs.length} ${destination.jobs.length === 1 ? 'job delivers' : 'jobs deliver'} to ${destination.name}`}
                        heading="Jobs that deliver here"
                      />
                    </td>
                    <ActionsCell>
                      {editable && (
                        <>
                          <RowAction onClick={() => setEditing(editable)}>
                            <PencilIcon />
                            Edit
                          </RowAction>
                          <RowMenu label={editable.name}>
                            <DropdownMenuItem onSelect={() => setEditing(editable)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(editable)}>
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
              {deleting?.kind === 'email'
                ? 'Spooldoc forgets the destination. Emails already sent stay sent. A destination that jobs deliver to cannot be deleted.'
                : deleting?.kind === 'webhook'
                  ? 'Spooldoc forgets the destination, its signing secret and its headers. A destination that jobs deliver to cannot be deleted.'
                  : deleting?.kind === 'sftp'
                    ? 'Spooldoc forgets the destination and its key or password. Deleting it never touches the server or its files. Remove its public key from the server too. A destination that jobs deliver to cannot be deleted.'
                  : 'Spooldoc forgets the destination. The folder and the files in it stay on the IBM i. A destination that jobs deliver to cannot be deleted.'}
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
