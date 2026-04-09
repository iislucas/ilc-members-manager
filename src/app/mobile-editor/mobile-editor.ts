import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, output, effect } from '@angular/core';
import { Editor, rootCtx, commandsCtx, defaultValueCtx, editorViewCtx, parserCtx } from '@milkdown/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInBulletListCommand, wrapInHeadingCommand, sinkListItemCommand, liftListItemCommand } from '@milkdown/preset-commonmark';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { indent } from '@milkdown/plugin-indent';

@Component({
  selector: 'app-mobile-editor',
  imports: [],
  templateUrl: './mobile-editor.html',
  styleUrl: './mobile-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileEditor implements AfterViewInit, OnDestroy {
  initialValue = input<string>('');
  changed = output<string>();

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
      .use(indent)
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
      const commands = ctx.get(commandsCtx);
      commands.call(toggleStrongCommand.key);
    });
  }

  toggleItalic() {
    this.editor?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(toggleEmphasisCommand.key);
    });
  }

  undo() {
    this.editor?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(undoCommand.key);
    });
  }

  redo() {
    this.editor?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(redoCommand.key);
    });
  }

  toggleBulletList() {
    this.editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { $from } = state.selection;
      const parent = $from.node(-1);
      
      const commands = ctx.get(commandsCtx);
      
      // Check if we are inside a list_item
      if (parent && parent.type.name === 'list_item') {
        commands.call(liftListItemCommand.key);
      } else {
        commands.call(wrapInBulletListCommand.key);
      }
    });
  }

  wrapInHeading(level: number) {
    this.editor?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(wrapInHeadingCommand.key, level);
    });
  }

  indent() {
    this.editor?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(sinkListItemCommand.key);
    });
  }

  unindent() {
    this.editor?.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(liftListItemCommand.key);
    });
  }
}
