import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailTemplatesComponent } from './email-templates';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { initEmailTemplates } from '../../../../functions/src/data-model';

describe('EmailTemplatesComponent', () => {
  let component: EmailTemplatesComponent;
  let fixture: ComponentFixture<EmailTemplatesComponent>;
  let mockDataManager: any;

  beforeEach(async () => {
    mockDataManager = {
      emailTemplates: signal(initEmailTemplates()),
      saveEmailTemplates: vi.fn().mockResolvedValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [EmailTemplatesComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataManager }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EmailTemplatesComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display the subjects of templates', () => {
    const el = fixture.nativeElement;
    const inputs = el.querySelectorAll('input');

    expect(inputs[0].value).toBe('Welcome to the I Liq Chuan Family!');
    expect(inputs[1].value).toBe('Congratulations on your Instructor License!');
  });

  it('should feed each template body into a markdown editor', () => {
    const el = fixture.nativeElement;
    // The bodies are edited in the markdown editor (rendered async by Milkdown),
    // so assert the wiring: one editor per template, seeded from the model.
    const editors = el.querySelectorAll('app-markdown-editor');
    expect(editors.length).toBe(2);
    expect(component.templates().membershipActivatedBody).toContain(
      'Welcome to the I Liq Chuan family!',
    );
    expect(component.templates().instructorLicenseActivatedBody).toContain(
      'Congratulations on getting your Instructor ID',
    );
  });

  it('should update the body model when the editor emits a change', () => {
    component.setMemberBody('New **welcome** body with {name}.');
    expect(component.templates().membershipActivatedBody).toBe(
      'New **welcome** body with {name}.',
    );
    // Other fields are preserved.
    expect(component.templates().membershipActivatedSubject).toBe(
      'Welcome to the I Liq Chuan Family!',
    );
  });

  it('should call saveEmailTemplates when clicking Save Templates button', async () => {
    const el = fixture.nativeElement;
    const btn = el.querySelector('button.btn-primary');
    btn.click();
    expect(mockDataManager.saveEmailTemplates).toHaveBeenCalled();
  });
});
