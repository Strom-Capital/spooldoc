'use client';

import { CheckCircle2Icon, InboxIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, RefreshCwIcon, ServerIcon, Trash2Icon, XCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyNote, ErrorNote, Page } from '@/components/page';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { ago } from '@/lib/client/format';
import type { ServerView } from '@/lib/types';
import { ServerDialog } from './server-dialog';

/** The server list with add, edit, test and delete. */
export function ServersPage({ allowedHosts }: { allowedHosts: string[] }) {
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServerView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ServerView | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

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

  async function test(server: ServerView) {
    setTesting(server.id);
    try {
      await api(`/api/servers/${server.id}/test`, { method: 'POST' });
      toast.success(`Connected to ${server.name}`);
    } catch (err) {
      // The error is also recorded on the server and shown in the row.
      toast.error(`Could not connect to ${server.name}`, { description: errorText(err) });
    }
    setTesting(null);
    await load();
  }

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
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Loading servers...
        </div>
      )}
      {servers?.length === 0 && (
        <EmptyNote>
          <ServerIcon className="mx-auto mb-2 size-6" aria-hidden />
          No servers yet. Add the IBM i whose spooled files you want to turn into documents.
          <div className="mt-4">
            <Button onClick={() => setEditing('new')}>
              <PlusIcon />
              Add server
            </Button>
          </div>
        </EmptyNote>
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
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.id} className="border-t align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{server.name}</div>
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
                    {server.lastError ? (
                      <div className="flex max-w-sm items-start gap-1.5 text-destructive">
                        <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>{server.lastError}</span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        <span>
                          {server.vrm ?? 'Signed on'}
                          {server.ccsid ? <span className="text-muted-foreground">, CCSID {server.ccsid}</span> : null}
                        </span>
                      </div>
                    )}
                    {server.lastCheckedAt && <div className="mt-0.5 text-muted-foreground text-xs">Checked {ago(server.lastCheckedAt)}</div>}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{server.hiddenQueues ?? 0}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/queues?server=${server.id}`}>
                          <InboxIcon />
                          Queues
                        </Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => test(server)} disabled={testing === server.id}>
                        {testing === server.id ? <Spinner /> : <RefreshCwIcon />}
                        Test
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${server.name}`}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(server)}>
                            <PencilIcon />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(server)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
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
