'use client';

import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { labelTaken, newOutput, OUTPUT_FORMATS, type JobOutput, type OutputFormat } from '@/lib/job-spec';
import { useJob } from './job-provider';

const FORMAT_LABEL: Record<OutputFormat, string> = { pdf: 'PDF', html: 'HTML' };

/** "PDF and HTML". */
export function formatList(formats: readonly OutputFormat[]): string {
  return formats.map((format) => FORMAT_LABEL[format]).join(' and ');
}

/**
 * The render step's output controls: which output the template and preview show, the
 * formats it makes (at least one), Add output, and a menu to rename or remove it.
 */
export function OutputControls({ output, onPick }: { output: JobOutput; onPick(id: string): void }) {
  const { spec, readOnly, updateDraft } = useJob();
  const outputs = spec.render.outputs;
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const save = (next: JobOutput[]) => updateDraft({ render: { outputs: next } }, { debounce: false });

  const toggle = (format: OutputFormat, on: boolean) => {
    const formats = on ? [...output.formats, format] : output.formats.filter((f) => f !== format);
    if (formats.length > 0) {
      save(outputs.map((o) => (o.id === output.id ? { ...o, formats: OUTPUT_FORMATS.filter((f) => formats.includes(f)) } : o)));
    }
  };

  const add = () => {
    const added = newOutput(outputs);
    save([...outputs, added]);
    onPick(added.id);
    toast.success(`Added ${added.label}`);
  };

  const remove = () => {
    const index = outputs.findIndex((o) => o.id === output.id);
    const rest = outputs.filter((o) => o.id !== output.id);
    save(rest);
    onPick(rest[Math.max(0, index - 1)]!.id);
    toast.success(`Removed ${output.label}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Select value={output.id} onValueChange={onPick}>
        <SelectTrigger size="sm" className="max-w-48" aria-label="Output">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {outputs.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div role="group" aria-label={`Formats of ${output.label}`} className="flex items-center gap-3">
        {OUTPUT_FORMATS.map((format) => {
          const checked = output.formats.includes(format);
          return (
            <label key={format} className="flex items-center gap-1.5">
              <Checkbox
                checked={checked}
                disabled={readOnly || (checked && output.formats.length === 1)}
                onCheckedChange={(on) => toggle(format, on === true)}
                aria-label={`Make ${FORMAT_LABEL[format]} files for ${output.label}`}
              />
              {FORMAT_LABEL[format]}
            </label>
          );
        })}
      </div>
      {!readOnly && (
        <>
          <Button size="sm" variant="ghost" onClick={add}>
            <PlusIcon />
            Add output
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${output.label}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              {outputs.length > 1 && (
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
                  <Trash2Icon />
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {renaming && (
        <RenameOutputDialog
          output={output}
          outputs={outputs}
          onClose={() => setRenaming(false)}
          onRename={(label) => save(outputs.map((o) => (o.id === output.id ? { ...o, label } : o)))}
        />
      )}
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {output.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft stops making its files, and its template is removed from the draft. Saved versions keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Rename an output. The name is added to its file names, so it must differ from the other outputs' names. */
function RenameOutputDialog({
  output,
  outputs,
  onClose,
  onRename,
}: {
  output: JobOutput;
  outputs: JobOutput[];
  onClose(): void;
  onRename(label: string): void;
}) {
  const [label, setLabel] = useState(output.label);
  const name = label.trim();
  const problem = !name ? 'Name the output.' : labelTaken(outputs, name, output.id) ? `Another output is named ${name}. Pick another name.` : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) return;
    if (name !== output.label) {
      onRename(name);
      toast.success(`Renamed ${output.label} to ${name}`);
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename {output.label}</DialogTitle>
            <DialogDescription>Files of every output but the first add this name, as in invoice-260101-lines.pdf.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="output-label">Name</Label>
            <Input
              id="output-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={40}
              autoFocus
              aria-invalid={!!problem}
              aria-describedby={problem ? 'output-label-problem' : undefined}
            />
            {problem && (
              <p id="output-label-problem" className="text-destructive text-xs">
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
