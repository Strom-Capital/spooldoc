'use client';

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder as placeholderText,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

export type CodeLanguage = 'yaml' | 'html' | 'json';

/** Token colors from the --syntax-* variables in globals.css, so they follow the theme. */
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--syntax-property)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--syntax-number)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syntax-tag)' },
  { tag: [tags.attributeName, tags.className, tags.labelName], color: 'var(--syntax-attribute)' },
  { tag: [tags.comment, tags.meta, tags.documentMeta], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--destructive)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.25rem' },
  '.cm-content': { paddingBlock: '8px', caretColor: 'var(--foreground)' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-gutters': { backgroundColor: 'var(--background)', color: 'var(--muted-foreground)', border: 'none', opacity: '0.7' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--primary) 15%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in oklab, var(--primary) 20%, transparent)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--muted)', border: 'none', color: 'var(--muted-foreground)' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-panels': { backgroundColor: 'var(--muted)', color: 'var(--foreground)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-template-tag': { backgroundColor: 'var(--syntax-template)', color: 'var(--primary)', borderRadius: '2px' },
});

/** Carbone tags (`{d.doc.x}`, `{#alias = ...}`, `{t(text)}`, ...) and `{asset('name')}` marked on top of the HTML highlighting. */
const tagMatcher = new MatchDecorator({
  regexp: /\{(?:[dco](?=[.[:}])|#|\$|t\(|asset\()[^{}\n]*\}/g,
  decoration: Decoration.mark({ class: 'cm-template-tag' }),
});
const templateTags = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tagMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = tagMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Marks a change that came from `value`, so it is not reported back through `onChange`. */
const external = Annotation.define<boolean>();

const LANGUAGES: Record<CodeLanguage, () => Extension> = {
  yaml: () => yaml(),
  html: () => [html(), templateTags],
  json: () => json(),
};

/**
 * A CodeMirror editor with line numbers, folding, search (Mod+F) and syntax colors for
 * the language. Tab indents; Escape then Tab moves focus on. `readOnly` makes a viewer.
 * A changed `value` replaces the text without being reported through `onChange`.
 */
export function CodeEditor({
  value,
  onChange,
  label,
  language,
  placeholder,
  readOnly = false,
  autoHeight = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  label: string;
  language: CodeLanguage;
  placeholder?: string;
  readOnly?: boolean;
  /** Grow with the content instead of filling and scrolling the parent. */
  autoHeight?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initial = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
          syntaxHighlighting(highlightStyle),
          theme,
          autoHeight ? EditorView.theme({ '&': { height: 'auto' }, '.cm-scroller': { overflow: 'visible' } }) : [],
          LANGUAGES[language](),
          EditorState.tabSize.of(2),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          placeholder ? placeholderText(placeholder) : [],
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [language, readOnly, autoHeight, label, placeholder]);

  // Take outside changes (a saved file, the chat, another document) without losing the cursor when typing.
  useEffect(() => {
    initial.current = value;
    const editor = view.current;
    const current = editor?.state.doc.toString();
    if (editor && current !== undefined && current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: external.of(true) });
    }
  }, [value]);

  return <div ref={host} className={autoHeight ? 'w-full' : 'h-full min-h-0 w-full flex-1 overflow-hidden'} />;
}
