/* confirm-delete-modal.component.spec.ts
 *
 * Unit tests for ConfirmDeleteModalComponent verifying safety checks,
 * confirmation inputs, and event emissions.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmDeleteModalComponent } from './confirm-delete-modal.component';
import { ComponentRef } from '@angular/core';

describe('ConfirmDeleteModalComponent', () => {
  let fixture: ComponentFixture<ConfirmDeleteModalComponent>;
  let component: ConfirmDeleteModalComponent;
  let componentRef: ComponentRef<ConfirmDeleteModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfirmDeleteModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmDeleteModalComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should not render modal backdrop or dialog when isOpen is false', () => {
    componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    const backdrop = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(backdrop).toBeNull();
  });

  it('should render modal dialog and entity details when isOpen is true', () => {
    componentRef.setInput('isOpen', true);
    componentRef.setInput('entityName', 'Pietro Lorenzini');
    componentRef.setInput('entityIdentifier', 'IT32');
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.modal-dialog');
    expect(dialog).toBeTruthy();

    const nameEl = fixture.nativeElement.querySelector('.entity-value.highlight');
    expect(nameEl?.textContent).toContain('Pietro Lorenzini');

    const idEl = fixture.nativeElement.querySelector('.entity-value.monospace');
    expect(idEl?.textContent).toContain('IT32');
  });

  it('should disable delete button until risk is understood and DELETE is typed', () => {
    componentRef.setInput('isOpen', true);
    componentRef.setInput('confirmWord', 'DELETE');
    fixture.detectChanges();

    const deleteBtn = fixture.nativeElement.querySelector('.delete-confirm-btn');
    expect(deleteBtn.disabled).toBe(true);

    // Check risk checkbox only
    component.understoodRisk.set(true);
    fixture.detectChanges();
    expect(deleteBtn.disabled).toBe(true);

    // Type incorrect word
    component.confirmationInput.set('WRONG');
    fixture.detectChanges();
    expect(deleteBtn.disabled).toBe(true);

    // Type correct confirmation word (case-insensitive)
    component.confirmationInput.set('delete');
    fixture.detectChanges();
    expect(deleteBtn.disabled).toBe(false);
  });

  it('should emit confirmed when delete button is clicked', () => {
    componentRef.setInput('isOpen', true);
    component.understoodRisk.set(true);
    component.confirmationInput.set('DELETE');
    fixture.detectChanges();

    const confirmedSpy = vi.fn();
    component.confirmed.subscribe(confirmedSpy);

    const deleteBtn = fixture.nativeElement.querySelector('.delete-confirm-btn');
    deleteBtn.click();

    expect(confirmedSpy).toHaveBeenCalledTimes(1);
    expect(component.isDeleting()).toBe(true);
  });

  it('should emit cancelled and reset state when Cancel button is clicked', () => {
    componentRef.setInput('isOpen', true);
    component.understoodRisk.set(true);
    component.confirmationInput.set('DELETE');
    fixture.detectChanges();

    const cancelledSpy = vi.fn();
    component.cancelled.subscribe(cancelledSpy);

    const cancelBtn = fixture.nativeElement.querySelector('.subtle-button');
    cancelBtn.click();

    expect(cancelledSpy).toHaveBeenCalledTimes(1);
    expect(component.confirmationInput()).toBe('');
    expect(component.understoodRisk()).toBe(false);
  });
});
