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
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-markdown-editor',
  imports: [IconComponent],
  templateUrl: './markdown-editor.html',
  styleUrl: './markdown-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditor implements AfterViewInit, OnDestroy {
  initialValue = input<string>('');
  changed = output<string>();
  menuOpen = signal<boolean>(false);
  showDescriptions = signal<boolean>(false);
  
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

  @ViewChild('editorRef') editorRef!: ElementRef;
  private editor?: Editor;
  private isFirstLoad = true;
  private lastTap = 0;
  private tapCount = 0;

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

  ngOnDestroy() {
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
        
        // Get coordinates
        const coords = view.coordsAtPos($from.pos);
        let left = coords.left;
        const estimatedWidth = 320; // Approx width of popup
        const viewportWidth = window.innerWidth;
        
        if (left + estimatedWidth > viewportWidth - 16) {
          left = viewportWidth - estimatedWidth - 16;
        }
        if (left < 16) left = 16;
        
        this.linkPopupPos.set({
          top: coords.bottom + 8,
          left: left,
        });
        
        this.linkPreviewOpen.set(false);
        this.linkPopupOpen.set(true);
      } else {
        // No link at cursor, use popup for new link (with or without selection)
        this.linkUrl.set('');
        this.currentLinkRange.set({ from: $from.pos, to: $to.pos });
        
        const coords = view.coordsAtPos($from.pos);
        let left = coords.left;
        const estimatedWidth = 320;
        const viewportWidth = window.innerWidth;
        
        if (left + estimatedWidth > viewportWidth - 16) {
          left = viewportWidth - estimatedWidth - 16;
        }
        if (left < 16) left = 16;
        
        this.linkPopupPos.set({
          top: coords.bottom + 8,
          left: left,
        });
        
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
            let left = coords.left;
            const estimatedWidth = 200; // Approx width of preview
            const viewportWidth = window.innerWidth;
            
            if (left + estimatedWidth > viewportWidth - 16) {
              left = viewportWidth - estimatedWidth - 16;
            }
            if (left < 16) left = 16;
            
            this.linkPreviewPos.set({
              top: coords.bottom + 8,
              left: left,
            });
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
