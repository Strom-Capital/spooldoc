'use client';

import { PencilIcon, PlusIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, Loading } from '@/components/empty-state';
import { ErrorNote, Page } from '@/components/page';
import { ActionsCell, ActionsHead, RowAction, RowMenu, useRowOpen } from '@/components/row-actions';
import { ServerStatus, useReconnect } from '@/components/server-status';
import { Button } from '@/components/ui/button';
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
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import type { ServerView } from '@/lib/types';
import { ServerDialog } from './server-dialog';

/** The server list with each server's connection status, and add, edit, reconnect and delete. */
export function ServersPage({ allowedHosts }: { allowedHosts: string[] }) {
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServerView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ServerView | null>(null);

  const load = useCallback(async () => {
    try {
      setServers((await api<{ servers: ServerView[] }>('/api/servers')).servers);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    api<{ servers: ServerView[] }>('/api/servers').then(
      (data) => setServers(data.servers),
      (err) => setError(errorText(err)),
    );
  }, []);

  // The row shows the result either way: Connected, or why not.
  const { reconnect, pending } = useReconnect(() => void load());
  const rowOpen = useRowOpen();

  async function remove(server: ServerView) {
    try {
      await api(`/api/servers/${server.id}`, { method: 'DELETE' });
      setDeleting(null);
      toast.success(`Deleted ${server.name}`);
      await load();
    } catch (err) {
      setDeleting(null);
      toast.error(`Could not delete ${server.name}`, { description: errorText(err) });
    }
  }

  return (
    <Page
      title="Servers"
      description="IBM i systems Spooldoc reads output queues from. Passwords are kept encrypted on this server."
      actions={
        <Button onClick={() => setEditing('new')}>
          <PlusIcon />
          Add server
        </Button>
      }
    >
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {servers === null && !error && (
        <Loading>Loading servers...</Loading>
      )}
      {servers?.length === 0 && (
        <EmptyState icon={ServerIcon} title="No servers yet" description="Add the IBM i whose spooled files you want to turn into documents.">
          <Button onClick={() => setEditing('new')}>
            <PlusIcon />
            Add server
          </Button>
        </EmptyState>
      )}
      {servers && servers.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Server</th>
                <th className="px-3 py-2 font-medium">Libraries</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Hidden queues</th>
                <ActionsHead />
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.id} {...rowOpen(`/queues?server=${server.id}`, 'border-t align-top')}>
                  <td className="px-3 py-2.5">
                    <Link href={`/queues?server=${server.id}`} className="font-medium text-primary hover:underline">
                      {server.name}
                    </Link>
                    <div className="font-mono text-muted-foreground text-xs">
                      {server.user}@{server.host}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {server.libraries.length === 0 ? (
                      <span className="text-muted-foreground">All libraries</span>
                    ) : (
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {server.libraries.map((library) => (
                          <span key={library} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            {library}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <ServerStatus server={server} connecting={pending === server.id} />
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{server.hiddenQueues ?? 0}</td>
                  <ActionsCell>
                    <RowAction onClick={() => void reconnect(server)} disabled={pending !== null}>
                      {pending === server.id ? <Spinner /> : <RefreshCwIcon />}
                      Reconnect
                    </RowAction>
                    <RowAction onClick={() => setEditing(server)}>
                      <PencilIcon />
                      Edit
                    </RowAction>
                    <RowMenu label={server.name}>
                      <DropdownMenuItem onSelect={() => void reconnect(server)} disabled={pending !== null}>
                        <RefreshCwIcon />
                        Reconnect
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setEditing(server)}>
                        <PencilIcon />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(server)}>
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </RowMenu>
                  </ActionsCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ServerDialog
          server={editing === 'new' ? null : editing}
          allowedHosts={allowedHosts}
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
              Spooldoc forgets the server, its password and its hidden queues. Nothing changes on the IBM i. A server that jobs read
              from cannot be deleted.
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
