/*
  A lightweight, touch-friendly Markdown editor for Angular 21 (Zoneless).

  ## Philosophy & Approach:
  1. Mobile-First Design: The editor is optimized for mobile screens and virtual keyboards.
     - Toolbar buttons are 44px touch targets and horizontally scrollable.
     - Layout adjusts to ensure the editor fills the available space without page scrolling.
  2. Zoneless Angular 21: Leverages signals and standalone components for maximum performance
     and minimal overhead without Zone.js.
  3. Minimal Milkdown Core: We avoid heavy presets like `milkdown/crepe` to maintain control
     over the UI and bundle size. We use only core plugins (commonmark, history, listener, indent).
  4. Custom UI over Default Themes: We provide our own CSS for markdown nodes (headings, lists)
     in `mobile-editor.scss` rather than relying on a heavy Milkdown theme plugin, ensuring a native feel.
  5. Focus Retention: Every action restores focus to the editor (`view.focus()`) to keep the
     mobile keyboard visible and preserve the user's cursor position.
  6. Web Component Friendly: The component is designed to be exported as a Custom Element for
     isolated testing and use in non-Angular contexts. It should also be possible simply to use this 
     as a library in the broader project.
*/

import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, output, effect, signal } from '@angular/core';
import { Editor, rootCtx, commandsCtx, defaultValueCtx, editorViewCtx, parserCtx } from '@milkdown/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInHeadingCommand, wrapInBulletListCommand, sinkListItemCommand, liftListItemCommand } from '@milkdown/preset-commonmark';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { indent as indentPlugin } from '@milkdown/plugin-indent';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-mobile-editor',
  imports: [IconComponent],
  templateUrl: './mobile-editor.html',
  styleUrl: './mobile-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileEditor implements AfterViewInit, OnDestroy {
  initialValue = input<string>('');
  changed = output<string>();
  menuOpen = signal<boolean>(false);
  showDescriptions = signal<boolean>(false);

  @ViewChild('editorRef') editorRef!: ElementRef;
  private editor?: Editor;
  private isFirstLoad = true;

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
}
