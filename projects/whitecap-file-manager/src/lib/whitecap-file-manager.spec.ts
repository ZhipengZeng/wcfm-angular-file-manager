import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WhitecapFileManagerComponent } from './whitecap-file-manager';

describe('WhitecapFileManagerComponent', () => {
  let component: WhitecapFileManagerComponent;
  let fixture: ComponentFixture<WhitecapFileManagerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WhitecapFileManagerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WhitecapFileManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
