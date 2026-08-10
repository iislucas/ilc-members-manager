/*
  A lightweight, touch-friendly Markdown editor for Angular 21 (Zoneless).

  ## Philosophy & Approach:
  1. Mobile-Friendly Design: The editor is optimized for both desktop and mobile screens.
     - Toolbar buttons are 44px touch targets and horizontally scrollable.
     - Layout adjusts to ensure the editor fills the available space without page scrolling.
  2. Zoneless Angular 21: Leverages signals and standalone components for maximum performance
     and minimal overhead without Zone.js.
  3. Minimal Milkdown Core: We avoid heavy presets like `milkdown/crepe` to maintain control
     over the UI and bundle size. We use only core plugins (commonmark, history, listener, indent).
  4. Custom UI over Default Themes: We provide our own CSS for markdown nodes (headings, lists)
      in `markdown-editor.scss` rather than relying on a heavy Milkdown theme plugin, ensuring a native feel.
  5. Focus Retention: Every action restores focus to the editor (`view.focus()`) to keep the
     mobile keyboard visible and preserve the user's cursor position.
  6. Web Component Friendly: The component is designed to be exported as a Custom Element for
     isolated testing and use in non-Angular contexts. It should also be possible simply to use this 
     as a library in the broader project.
*/

import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, output, effect, signal, computed } from '@angular/core';
import { Editor, rootCtx, commandsCtx, defaultValueCtx, editorViewCtx, parserCtx } from '@milkdown/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInHeadingCommand, wrapInBulletListCommand, sinkListItemCommand, liftListItemCommand } from '@milkdown/preset-commonmark';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { indent as indentPlugin } from '@milkdown/plugin-indent';
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { Node as ProseNode } from '@milkdown/prose/model';
import { IconComponent } from '../icons/icon.component';

// Content-producing toolbar actions that can be individually enabled. Used to
// restrict the editor to whatever subset the downstream renderer supports (e.g.
// the email template editor only allows bold + link). Undo/redo and
// clear-formatting are always available since they never introduce unsupported
// markup.
export type MarkdownFeature = 'bold' | 'italic' | 'heading' | 'bulletList' | 'indent' | 'link';

// A generic, insertable, non-editable token surfaced by the editor. Chips are a
// pure view-layer concern: their `token` text lives verbatim in the markdown, so
// serialization/parsing is untouched — the editor only adds a one-click way to
// insert a token and renders any occurrences of it as a styled pill. Callers use
// this for placeholders (e.g. `{name}` in an email template), mentions, merge
// fields, etc.
export interface EditorChip {
  // Literal text inserted into and matched within the document, e.g. '{name}'.
  token: string;
  // Optional label for the insertion button; defaults to `token`.
  label?: string;
}

@Component({
  selector: 'app-markdown-editor',
  imports: [IconComponent],
  templateUrl: './markdown-editor.html',
  styleUrl: './markdown-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class MarkdownEditor implements AfterViewInit, OnDestroy {
  initialValue = input<string>('');
  // Insertable placeholder tokens rendered as chips (see EditorChip). Empty by
  // default, so editors without chips behave exactly as before.
  chips = input<EditorChip[]>([]);
  // Which content-producing toolbar features to expose. `null` (the default)
  // shows all of them, preserving the full editor for existing callers; pass a
  // list to restrict to a supported subset.
  enabledFeatures = input<MarkdownFeature[] | null>(null);
  changed = output<string>();
  menuOpen = signal<boolean>(true);
  isFullscreen = signal<boolean>(false);
  showDescriptions = signal<boolean>(false);
  canScrollLeft = signal<boolean>(false);
  canScrollRight = signal<boolean>(false);
  
  linkPopupOpen = signal<boolean>(false);
  linkPopupPos = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  linkUrl = signal<string>('');
  currentLinkRange = signal<{ from: number; to: number } | null>(null);
  
  linkPreviewOpen = signal<boolean>(false);
  linkPreviewPos = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  linkPreviewUrl = signal<string>('');
  
  truncatedUrl = computed(() => {
    const url = this.linkPreviewUrl();
    if (!url) return '';
    if (url.length <= 40) return url;
    return url.substring(0, 20) + '...' + url.substring(url.length - 15);
  });

  private featureSet = computed(() => {
    const list = this.enabledFeatures();
    return list === null ? null : new Set(list);
  });

  // Whether a given content-producing toolbar feature should be shown. A null
  // feature set (the default) enables everything.
  protected has(feature: MarkdownFeature): boolean {
    const set = this.featureSet();
    return set === null || set.has(feature);
  }

  @ViewChild('editorRef') editorRef!: ElementRef;
  @ViewChild('contentWrapper') contentWrapperRef!: ElementRef;
  @ViewChild('editorContainer') containerRef!: ElementRef;
  @ViewChild('menuRef') menuRef?: ElementRef<HTMLElement>;
  private menuResizeObserver?: ResizeObserver;
  private editor?: Editor;
  private isFirstLoad = true;
  private lastTap = 0;
  private tapCount = 0;

  toggleMenu() {
    const nextState = !this.menuOpen();
    this.menuOpen.set(nextState);
    if (nextState) {
      setTimeout(() => {
        this.updateScrollState();
        this.setupMenuResizeObserver();
      }, 0);
    } else {
      this.menuResizeObserver?.disconnect();
    }
  }

  toggleFullscreen() {
    const next = !this.isFullscreen();
    this.isFullscreen.set(next);
    setTimeout(() => {
      this.updateScrollState();
    }, 50);
  }

  onEscape() {
    if (this.isFullscreen()) {
      this.isFullscreen.set(false);
      setTimeout(() => {
        this.updateScrollState();
      }, 50);
    }
  }

  toggleDescriptions() {
    this.showDescriptions.set(!this.showDescriptions());
    setTimeout(() => this.updateScrollState(), 0);
  }

  updateScrollState() {
    const el = this.menuRef?.nativeElement;
    if (!el) {
      this.canScrollLeft.set(false);
      this.canScrollRight.set(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    this.canScrollLeft.set(scrollLeft > 1);
    this.canScrollRight.set(scrollLeft + clientWidth < scrollWidth - 1);
  }

  scrollToolbar(direction: 'left' | 'right') {
    const el = this.menuRef?.nativeElement;
    if (!el) return;
    const delta = direction === 'left' ? -120 : 120;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }

  private setupMenuResizeObserver() {
    this.menuResizeObserver?.disconnect();
    const el = this.menuRef?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.menuResizeObserver = new ResizeObserver(() => {
      this.updateScrollState();
    });
    this.menuResizeObserver.observe(el);
  }

  constructor() {
    effect(() => {
      const value = this.initialValue();
      if (this.editor && value && this.isFirstLoad) {
        this.setMarkdown(value);
        this.isFirstLoad = false; // Only set initially
      }
    });
  }

  ngAfterViewInit() {
    this.initEditor();
    this.setupTapHandlers();
    this.setupLinkPreview();
    this.setupClickBelowContent();
    if (this.menuOpen()) {
      setTimeout(() => {
        this.updateScrollState();
        this.setupMenuResizeObserver();
      }, 0);
    }
  }
  
  private setupTapHandlers() {
    const el = this.editorRef.nativeElement;
    el.addEventListener('touchstart', (e: TouchEvent) => {
      const now = Date.now();
      if (now - this.lastTap < 300) {
        this.tapCount++;
      } else {
        this.tapCount = 1;
      }
      this.lastTap = now;

      if (this.tapCount === 2) {
        this.selectWord();
        e.preventDefault(); // Prevent default double tap zoom
      } else if (this.tapCount === 3) {
        this.selectLine();
        e.preventDefault();
      }
    }, { passive: false });
  }

  // When the user clicks in the empty space below the last line of
  // content, focus the editor and move the cursor to the very end.
  private setupClickBelowContent() {
    const wrapper = this.contentWrapperRef.nativeElement;
    const editorEl = this.editorRef.nativeElement;

    const handleClick = (e: MouseEvent) => {
      // Only act when the click target is the wrapper or the
      // editor-content container itself (i.e. empty space, not a
      // ProseMirror content node inside).
      if (e.target !== wrapper && e.target !== editorEl) return;

      this.editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        // Position inside the last block node (doc.content.size is
        // after the last block, which isn't a valid cursor position).
        const endPos = Math.max(0, state.doc.content.size - 1);
        // Use the same pattern as selectWord/selectLine in this file.
        const SelectionConstructor = state.selection.constructor as never as {
          create: (doc: typeof state.doc, pos: number) => typeof state.selection;
        };
        const sel = SelectionConstructor.create(state.doc, endPos);
        view.dispatch(state.tr.setSelection(sel));
        view.focus();
      });
    };

    wrapper.addEventListener('click', handleClick);
    editorEl.addEventListener('click', handleClick);
  }
  // Converts viewport-relative coordinates from ProseMirror's
  // coordsAtPos into coordinates relative to the editor container
  // element, so absolutely-positioned popups stay anchored when
  // the page scrolls.
  private toContainerCoords(
    coords: { left: number; bottom: number },
    estimatedWidth: number,
  ): { top: number; left: number } {
    const rect = this.containerRef.nativeElement.getBoundingClientRect();
    const containerWidth = rect.width;
    let left = coords.left - rect.left;

    if (left + estimatedWidth > containerWidth - 16) {
      left = containerWidth - estimatedWidth - 16;
    }
    if (left < 0) left = 0;

    return {
      top: coords.bottom - rect.top + 8,
      left,
    };
  }

  ngOnDestroy() {
    this.menuResizeObserver?.disconnect();
    this.editor?.destroy();
  }

  private async initEditor() {
    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, this.editorRef.nativeElement);
        ctx.set(defaultValueCtx, this.initialValue());
        ctx.get(listenerCtx).markdownUpdated((ctx, markdown, prevMarkdown) => {
          this.changed.emit(markdown);
        });
      })
      .use(commonmark)
      .use(history)
      .use(listener)
      .use(indentPlugin)
      .use(this.chipDecorationPlugin())
      .create();
    
    this.editor = editor;
    
    // If initialValue was already set before editor was ready
    const value = this.initialValue();
    if (value && this.isFirstLoad) {
      this.setMarkdown(value);
      this.isFirstLoad = false;
    }
  }

  private setMarkdown(markdown: string) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      const doc = parser(markdown);
      if (!doc) return;
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc);
      view.dispatch(tr);
    });
  }

  // Inserts a chip's token text at the current selection, replacing any
  // selected range. The token is plain text, so it round-trips through the
  // markdown untouched and the decoration below re-styles it as a pill.
  insertChip(chip: EditorChip) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { from, to } = state.selection;
      view.dispatch(state.tr.insertText(chip.token, from, to));
      view.focus();
    });
  }

  // A ProseMirror plugin that decorates every occurrence of a configured chip
  // token with the `md-chip` class. Purely presentational: it adds no nodes or
  // marks, so the underlying document (and its markdown) is unchanged. Reads the
  // `chips` input lazily so it reflects whatever tokens are configured.
  private chipDecorationPlugin() {
    return $prose(() => new Plugin({
      key: new PluginKey('markdown-editor-chips'),
      props: {
        decorations: (state) => this.buildChipDecorations(state.doc),
      },
    }));
  }

  private buildChipDecorations(doc: ProseNode): DecorationSet {
    const tokens = this.chips().map((c) => c.token).filter((t) => t.length > 0);
    if (tokens.length === 0) return DecorationSet.empty;

    const decorations: Decoration[] = [];
    doc.descendants((node: ProseNode, pos: number) => {
      if (!node.isText || !node.text) return;
      const text = node.text;
      for (const token of tokens) {
        let idx = text.indexOf(token);
        while (idx !== -1) {
          const from = pos + idx;
          decorations.push(Decoration.inline(from, from + token.length, { class: 'md-chip' }));
          idx = text.indexOf(token, idx + token.length);
        }
      }
    });
    return DecorationSet.create(doc, decorations);
  }

  toggleBold() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(toggleStrongCommand.key);
      view.focus();
    });
  }

  toggleItalic() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(toggleEmphasisCommand.key);
      view.focus();
    });
  }

  undo() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(undoCommand.key);
      view.focus();
    });
  }

  redo() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(redoCommand.key);
      view.focus();
    });
  }

  toggleBulletList() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      const { state } = view;
      const { $from } = state.selection;
      const parent = $from.node(-1);

      if (parent && parent.type.name === 'list_item') {
        commands.call(liftListItemCommand.key);
      } else {
        commands.call(wrapInBulletListCommand.key);
      }

      view.focus();
    });
  }

  wrapInHeading(level: number) {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { heading, paragraph } = schema.nodes;

      const { $from, $to } = state.selection;
      const depth = $from.depth;

      if (depth === 0) return;

      const from = $from.before(depth);
      const to = $to.after(depth);

      const parent = $from.node(depth);
      const isHeading = parent.type.name === 'heading' && parent.attrs['level'] === level;

      const tr = state.tr;

      if (isHeading) {
        tr.setBlockType(from, to, paragraph);
      } else {
        tr.setBlockType(from, to, heading, { level });
      }

      view.dispatch(tr);
      view.focus();
    });
  }

  // Remove all inline marks (bold, italic, link, etc.) and reset block
  // types to paragraph. Operates on the current selection, or on the
  // whole block at the cursor when the selection is collapsed.
  clearFormatting() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { paragraph } = schema.nodes;
      const { $from, $to, empty } = state.selection;

      // Determine the range to clear: the selection itself, or the
      // entire block containing the cursor when nothing is selected.
      let from: number;
      let to: number;
      if (empty) {
        const depth = $from.depth;
        if (depth === 0) return;
        from = $from.before(depth);
        to = $from.after(depth);
      } else {
        from = $from.pos;
        to = $to.pos;
      }

      const tr = state.tr;

      // Strip every mark type from the range.
      for (const markType of Object.values(schema.marks)) {
        tr.removeMark(from, to, markType);
      }

      // Reset any block (headings, etc.) within the range to paragraph.
      tr.setBlockType(from, to, paragraph);

      view.dispatch(tr);
      view.focus();
    });
  }

  indent() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(sinkListItemCommand.key);
      view.focus();
    });
  }

  unindent() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const commands = ctx.get(commandsCtx);
      commands.call(liftListItemCommand.key);
      view.focus();
    });
  }

  toggleLink() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { link } = schema.marks;
      
      if (!link) return;

      const { $from, $to } = state.selection;
      
      // Find if there is a link at the cursor
      const mark = $from.marks().find(m => m.type.name === 'link');
      
      if (mark) {
        const url = mark.attrs['href'];
        this.linkUrl.set(url);
        
        // Find range
        let $pos = $from;
        let from = $pos.pos;
        let to = $pos.pos;
        while (from > 0 && mark.isInSet(state.doc.resolve(from - 1).marks())) from--;
        while (to < state.doc.content.size && mark.isInSet(state.doc.resolve(to).marks())) to++;
        
        this.currentLinkRange.set({ from, to });
        
        // Get coordinates relative to the editor container so the
        // popup scrolls with the content instead of staying fixed.
        const coords = view.coordsAtPos($from.pos);
        this.linkPopupPos.set(this.toContainerCoords(coords, 320));
        
        this.linkPreviewOpen.set(false);
        this.linkPopupOpen.set(true);
      } else {
        // No link at cursor, use popup for new link (with or without selection)
        this.linkUrl.set('');
        this.currentLinkRange.set({ from: $from.pos, to: $to.pos });
        
        const coords = view.coordsAtPos($from.pos);
        this.linkPopupPos.set(this.toContainerCoords(coords, 320));
        
        this.linkPreviewOpen.set(false);
        this.linkPopupOpen.set(true);
      }
      view.focus();
    });
  }

  private selectWord() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { $from } = state.selection;
      const text = $from.parent.textContent;
      const offset = $from.parentOffset;

      let start = offset;
      while (start > 0 && /\w/.test(text[start - 1])) start--;
      let end = offset;
      while (end < text.length && /\w/.test(text[end])) end++;

      const posStart = $from.before() + 1 + start;
      const posEnd = $from.before() + 1 + end;

      const SelectionConstructor = state.selection.constructor as any;
      const newSelection = SelectionConstructor.create(state.doc, posStart, posEnd);
      
      view.dispatch(state.tr.setSelection(newSelection));
      view.focus();
    });
  }

  private selectLine() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { $from } = state.selection;
      
      // Select the whole parent block (paragraph, heading, etc.)
      const start = $from.before();
      const end = $from.after();

      const SelectionConstructor = state.selection.constructor as any;
      const newSelection = SelectionConstructor.create(state.doc, start, end);
      
      view.dispatch(state.tr.setSelection(newSelection));
      view.focus();
    });
  }

  updateLink(newUrl: string) {
    if (!newUrl) {
      this.linkPopupOpen.set(false);
      return; // Do nothing if empty!
    }

    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { link } = schema.marks;
      const range = this.currentLinkRange();
      
      if (range && link) {
        if (range.from === range.to) {
          // Empty range! Insert text node with mark!
          const node = schema.text(newUrl, [link.create({ href: newUrl })]);
          view.dispatch(state.tr.insert(range.from, node));
        } else {
          // Non-empty range! Add mark!
          const tr = state.tr
            .removeMark(range.from, range.to, link)
            .addMark(range.from, range.to, link.create({ href: newUrl }));
          view.dispatch(tr);
        }
      }
      this.linkPopupOpen.set(false);
      view.focus();
    });
  }

  removeLink() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { schema } = state;
      const { link } = schema.marks;
      const range = this.currentLinkRange();
      
      if (range && link) {
        view.dispatch(state.tr.removeMark(range.from, range.to, link));
      }
      this.linkPopupOpen.set(false);
      this.linkPreviewOpen.set(false);
      view.focus();
    });
  }

  private setupLinkPreview() {
    const el = this.editorRef.nativeElement;
    const checkLink = () => {
      // Wait for ProseMirror to update selection after click/keyup!
      setTimeout(() => {
        this.editor?.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { $from } = state.selection;
          const mark = $from.marks().find(m => m.type.name === 'link');
          
          if (mark) {
            const url = mark.attrs['href'];
            this.linkPreviewUrl.set(url);
            
            // Find range for remove/edit actions!
            let $pos = $from;
            let from = $pos.pos;
            let to = $pos.pos;
            while (from > 0 && mark.isInSet(state.doc.resolve(from - 1).marks())) from--;
            while (to < state.doc.content.size && mark.isInSet(state.doc.resolve(to).marks())) to++;
            
            this.currentLinkRange.set({ from, to });
            
            const coords = view.coordsAtPos($from.pos);
            this.linkPreviewPos.set(this.toContainerCoords(coords, 200));
            this.linkPreviewOpen.set(true);
          } else {
            this.linkPreviewOpen.set(false);
          }
        });
      }, 0);
    };
    
    el.addEventListener('click', checkLink);
    el.addEventListener('keyup', checkLink);
    el.addEventListener('touchstart', checkLink);
  }

  openLink() {
    const url = this.linkPreviewUrl();
    if (url) {
      window.open(url, '_blank');
    }
    this.linkPreviewOpen.set(false);
  }
}
