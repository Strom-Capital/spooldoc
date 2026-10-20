'use client';

import { FileCodeIcon, FileTypeIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FORMAT_FILES,
  hasOwnContent,
  KIND_FORMATS,
  nameTaken,
  newTemplate,
  FORMATS,
  withContent,
  type JobTemplate,
  type Format,
  type TemplateKind,
} from '@/lib/job-spec';
import { useJob } from './job-provider';

const KIND_NAME: Record<TemplateKind, string> = { html: 'an HTML template', docx: 'a Word template' };

/**
 * The render step's end of the path: which template the editor and preview show, and a
 * menu with the files it makes (at least one), its kind (HTML or Word), Rename, Remove
 * and Add template.
 */
export function TemplateControls({ template, onPick }: { template: JobTemplate; onPick(id: string): void }) {
  const { spec, readOnly, updateDraft } = useJob();
  const templates = spec.render.templates;
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [switching, setSwitching] = useState<TemplateKind | null>(null);
  const kind = template.kind;

  const save = (next: JobTemplate[]) => updateDraft({ render: { templates: next } }, { debounce: false });

  const toggle = (format: Format, on: boolean) => {
    const formats = on ? [...template.formats, format] : template.formats.filter((f) => f !== format);
    if (formats.length > 0) {
      save(templates.map((t) => (t.id === template.id ? { ...t, formats: FORMATS.filter((f) => formats.includes(f)) } : t)));
    }
  };

  /** Use the other kind of template, starting from its starter. */
  const switchKind = (next: TemplateKind) => {
    const content = next === 'docx' ? ({ kind: 'docx', fileId: null } as const) : ({ kind: 'html', source: null } as const);
    save(templates.map((t) => (t.id === template.id ? withContent(t, content) : t)));
    setSwitching(null);
    toast.success(`${template.name} is ${next === 'docx' ? 'a Word' : 'an HTML'} template`);
  };

  const pickKind = (next: TemplateKind) => {
    if (hasOwnContent(template)) setSwitching(next);
    else switchKind(next);
  };

  const add = () => {
    const added = newTemplate(templates);
    save([...templates, added]);
    onPick(added.id);
    toast.success(`Added ${added.name}`);
  };

  const remove = () => {
    const index = templates.findIndex((t) => t.id === template.id);
    const rest = templates.filter((t) => t.id !== template.id);
    save(rest);
    onPick(rest[Math.max(0, index - 1)]!.id);
    toast.success(`Removed ${template.name}`);
  };

  const other: TemplateKind = kind === 'html' ? 'docx' : 'html';

  return (
    <>
      <ButtonGroup className="min-w-0">
        <select
          value={template.id}
          onChange={(event) => onPick(event.target.value)}
          aria-label="Template"
          className="h-7 min-w-0 max-w-56 truncate rounded-md border bg-background px-2 text-[0.8rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={`Settings of ${template.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-muted-foreground text-xs">Files it makes</DropdownMenuLabel>
              {KIND_FORMATS[kind].map((format) => {
                const checked = template.formats.includes(format);
                return (
                  <DropdownMenuCheckboxItem
                    key={format}
                    checked={checked}
                    disabled={checked && template.formats.length === 1}
                    onCheckedChange={(on) => toggle(format, on === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {FORMAT_FILES[format].label}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pickKind(other)}>
                {other === 'docx' ? <FileTypeIcon /> : <FileCodeIcon />}
                Make it {KIND_NAME[other]}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              {templates.length > 1 && (
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
                  <Trash2Icon />
                  Remove
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={add}>
                <PlusIcon />
                Add template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ButtonGroup>
      {renaming && (
        <RenameTemplateDialog
          template={template}
          templates={templates}
          onClose={() => setRenaming(false)}
          onRename={(name) => save(templates.map((t) => (t.id === template.id ? { ...t, name } : t)))}
        />
      )}
      <AlertDialog open={switching !== null} onOpenChange={(open) => !open && setSwitching(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make {template.name} {switching === 'docx' ? 'a Word' : 'an HTML'} template?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind === 'html' ? 'Its HTML' : 'Its uploaded Word file'} is removed from the draft, and the template starts from the{' '}
              {switching === 'docx' ? 'Word' : 'HTML'} starter. Saved versions keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => switching && switchKind(switching)}>Switch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {template.name}?</AlertDialogTitle>
            <AlertDialogDescription>The draft stops making its documents, and the template is removed from the draft. Saved versions keep it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Rename a template. The name is added to its file names, so it must differ from the other templates' names. */
function RenameTemplateDialog({
  template,
  templates,
  onClose,
  onRename,
}: {
  template: JobTemplate;
  templates: JobTemplate[];
  onClose(): void;
  onRename(name: string): void;
}) {
  const [value, setValue] = useState(template.name);
  const name = value.trim();
  const problem = !name ? 'Name the template.' : nameTaken(templates, name, template.id) ? `Another template is named ${name}. Pick another name.` : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) return;
    if (name !== template.name) {
      onRename(name);
      toast.success(`Renamed ${template.name} to ${name}`);
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename {template.name}</DialogTitle>
            <DialogDescription>Files of every template but the first add this name, as in invoice-260101-lines.pdf.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={40}
              autoFocus
              aria-invalid={!!problem}
              aria-describedby={problem ? 'template-name-problem' : undefined}
            />
            {problem && (
              <p id="template-name-problem" className="text-destructive text-xs">
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
