'use client';

import { CheckIcon, CopyIcon, ImageIcon, MoreHorizontalIcon, PlusIcon, RefreshCwIcon, Trash2Icon, TypeIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { EmptyNote, ErrorNote, Page } from '@/components/page';
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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError, errorText } from '@/lib/client/api';
import { ago, bytes } from '@/lib/client/format';
import type { AssetView } from '@/lib/types';

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.woff2,.woff,.ttf,.otf';

/** A file name as an asset name: `Company Logo.png` becomes `company-logo`. */
function nameFromFile(file: string): string {
  return file
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 64);
}

/** What to put in a template to use the asset. */
function usage(asset: AssetView): string {
  return asset.kind === 'font'
    ? `@font-face { font-family: "${asset.name}"; src: url("{{ asset('${asset.name}') }}"); }`
    : `<img src="{{ asset('${asset.name}') }}" alt="">`;
}

/** Send a multipart upload to an asset route; errors like `api`. */
async function upload(path: string, method: 'POST' | 'PUT', form: FormData): Promise<AssetView> {
  let response: Response;
  try {
    response = await fetch(path, { method, body: form, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'The server did not answer. Is it running?');
  }
  const data = (await response.json().catch(() => ({}))) as AssetView & { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `Upload failed (HTTP ${response.status}).`);
  }
  return data;
}

/** Images and fonts that templates print with `asset('name')`. */
export function AssetsPage() {
  const [assets, setAssets] = useState<AssetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<AssetView | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<AssetView | null>(null);

  const load = useCallback(async () => {
    try {
      setAssets((await api<{ assets: AssetView[] }>('/api/assets')).assets);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    api<{ assets: AssetView[] }>('/api/assets').then(
      (data) => setAssets(data.assets),
      (err) => setError(errorText(err)),
    );
  }, []);

  function chooseReplacement(asset: AssetView) {
    replaceTarget.current = asset;
    replaceInput.current?.click();
  }

  async function replace(file: File | undefined) {
    const asset = replaceTarget.current;
    if (!file || !asset) return;
    const form = new FormData();
    form.set('file', file);
    setReplacing(asset.id);
    try {
      await upload(`/api/assets/${asset.id}`, 'PUT', form);
      toast.success(`Replaced the file of ${asset.name}`);
      await load();
    } catch (err) {
      toast.error(`Could not replace ${asset.name}`, { description: errorText(err) });
    }
    setReplacing(null);
  }

  async function remove(asset: AssetView) {
    try {
      await api(`/api/assets/${asset.id}`, { method: 'DELETE' });
      setDeleting(null);
      toast.success(`Deleted ${asset.name}`);
      await load();
    } catch (err) {
      setDeleting(null);
      toast.error(`Could not delete ${asset.name}`, { description: errorText(err) });
    }
  }

  return (
    <Page
      title="Assets"
      description={
        <>
          Logos, images and fonts for templates. A template prints one with <code className="font-mono text-xs">{"{{ asset('name') }}"}</code>, and
          it is embedded in every document.
        </>
      }
      actions={
        <Button onClick={() => setAdding(true)}>
          <PlusIcon />
          Upload asset
        </Button>
      }
    >
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {assets === null && !error && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Loading assets...
        </div>
      )}
      {assets?.length === 0 && (
        <EmptyNote>
          <ImageIcon className="mx-auto mb-2 size-6" aria-hidden />
          No assets yet. Upload a company logo or a font to use it in templates.
          <div className="mt-4">
            <Button onClick={() => setAdding(true)}>
              <PlusIcon />
              Upload asset
            </Button>
          </div>
        </EmptyNote>
      )}
      {assets && assets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => (
            <section key={asset.id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
              <AssetPreview asset={asset} />
              <div className="flex flex-1 flex-col gap-2 border-t p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium font-mono text-sm">{asset.name}</h2>
                    <p className="text-muted-foreground text-xs">
                      {asset.kind === 'font' ? 'Font' : 'Image'}, {asset.contentType.split('/')[1]?.replace('+xml', '').toUpperCase()}, {bytes(asset.size)}
                      <span title={asset.updatedAt}>, changed {ago(asset.updatedAt)}</span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${asset.name}`} disabled={replacing === asset.id}>
                        {replacing === asset.id ? <Spinner /> : <MoreHorizontalIcon />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => chooseReplacement(asset)}>
                        <RefreshCwIcon />
                        Replace file
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(asset)}>
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <UsageSnippet text={usage(asset)} />
                <div className="mt-auto text-xs">
                  {asset.jobs.length === 0 ? (
                    <span className="text-muted-foreground">No template uses it yet.</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">Used by </span>
                      {asset.jobs.map((job, index) => (
                        <span key={job.id}>
                          {index > 0 && ', '}
                          <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
                            {job.name}
                          </Link>
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      <input
        ref={replaceInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          void replace(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {adding && (
        <UploadDialog
          onClose={() => setAdding(false)}
          onSaved={async (saved) => {
            toast.success(`Uploaded ${saved.name}`);
            setAdding(false);
            await load();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.jobs.length > 0
                ? `${deleting.jobs.map((job) => job.name).join(', ')} ${deleting.jobs.length === 1 ? 'prints' : 'print'} it. Their documents fail to render until an asset with this name is uploaded again.`
                : 'No template uses it. Documents already delivered keep their copy.'}
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

/** The image on a checkerboard, or a line of text in the font. */
function AssetPreview({ asset }: { asset: AssetView }) {
  const src = `/api/assets/${asset.id}?v=${encodeURIComponent(asset.updatedAt)}`;
  const family = `spooldoc-asset-${asset.id}-${new Date(asset.updatedAt).getTime()}`;
  const [font, setFont] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (asset.kind !== 'font') return;
    const face = new FontFace(family, `url("${src}")`);
    let live = true;
    face.load().then(
      (loaded) => {
        document.fonts.add(loaded);
        if (live) setFont('ready');
      },
      () => live && setFont('failed'),
    );
    return () => {
      live = false;
      document.fonts.delete(face);
    };
  }, [asset.kind, family, src]);

  if (asset.kind === 'font') {
    return (
      <div className="flex h-32 items-center justify-center bg-muted/40 px-4 text-center">
        {font === 'loading' && <Spinner />}
        {font === 'failed' && (
          <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <TypeIcon className="size-4" aria-hidden /> No preview for this font
          </span>
        )}
        {font === 'ready' && (
          <p style={{ fontFamily: `"${family}"` }} className="text-2xl leading-snug">
            Invoice 2026
            <br />
            <span className="text-base">Aa Bb Cc Åå Ää Öö 0123456789</span>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-32 items-center justify-center bg-[length:16px_16px] bg-[conic-gradient(var(--color-muted)_25%,transparent_0_50%,var(--color-muted)_0_75%,transparent_0)] p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded file served by the app, not a static image */}
      <img src={src} alt={asset.name} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

/** The template line that prints the asset, with a copy button. */
function UsageSnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted/60 py-1 pr-1 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={text}>
        {text}
      </code>
      <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy template code" title="Copy template code">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/** Pick a file and name it. The name is what templates use, so it cannot change later. */
function UploadDialog({ onClose, onSaved }: { onClose(): void; onSaved(asset: AssetView): void }) {
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await upload('/api/assets', 'POST', new FormData(event.currentTarget)));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload asset</DialogTitle>
          <DialogDescription>An image (PNG, JPEG, GIF, WebP, SVG) or a font (WOFF2, WOFF, TTF, OTF), at most 5 MB.</DialogDescription>
        </DialogHeader>
        <form id="asset-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-file">File</Label>
            <Input
              id="asset-file"
              name="file"
              type="file"
              required
              accept={ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file && !named) setName(nameFromFile(file.name));
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-name">Name</Label>
            <Input
              id="asset-name"
              name="name"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNamed(true);
              }}
              placeholder="logo"
              pattern="[a-z0-9][a-z0-9_\-]{0,63}"
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, digits, dashes and underscores. Templates print it with{' '}
              <code className="font-mono">{`{{ asset('${name || 'name'}') }}`}</code>.
            </p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="asset-form" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
