import { Component, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule, isFormArray } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { CommonModule } from '@angular/common';

export enum AssignKind {
  AssignNewManualId = 'AssignNewManualId',
  AssignNewAutoId = 'AssignNewAutoId',
  UnchangedExistingId = 'UnchangedExistingId',
  RemoveId = 'RemoveId',
}

export type Assignment =
  | {
      kind: AssignKind.AssignNewAutoId;
      curId: string;
    }
  | {
      kind: AssignKind.AssignNewManualId;
      newId: string;
      curId: string;
    }
  | {
      kind: AssignKind.UnchangedExistingId;
      curId: string;
    }
  | {
      kind: AssignKind.RemoveId;
      curId: string;
    };

@Component({
  selector: 'app-id-assignment',
  standalone: true,
  imports: [FormsModule, IconComponent, CommonModule],
  templateUrl: './id-assignment.html',
  styleUrl: './id-assignment.scss',
})
export class IdAssignmentComponent {
  AssignKind = AssignKind;

  initAssignment = input.required<Assignment>();
  editedAssignment = linkedSignal(() => this.initAssignment());
  canEdit = input.required<boolean>();
  expectedNextId = input.required<string>();
  canBeUnset = input<boolean>(false);

  assignment = output<Assignment>();

  // State
  menuOpen = signal(false);

  effect() {
    if (this.editedAssignment() !== this.initAssignment()) {
      this.assignment.emit(this.editedAssignment());
    }
  }
}
