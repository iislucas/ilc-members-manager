import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core'; // Assuming this import is needed for provideZonelessChangeDetection

import { ProfileMenuComponent } from './profile-menu';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { ImageLoaderService } from '../image-loader.service';

describe('ProfileMenuComponent', () => {
  let component: ProfileMenuComponent;
  let fixture: ComponentFixture<ProfileMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileMenuComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
        { provide: ImageLoaderService, useValue: { loadImage: () => Promise.resolve('blob:url') } },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProfileMenuComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
