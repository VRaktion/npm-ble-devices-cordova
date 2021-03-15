import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BleDevicesCordovaComponent } from './ble-devices-cordova.component';

describe('BleDevicesCordovaComponent', () => {
  let component: BleDevicesCordovaComponent;
  let fixture: ComponentFixture<BleDevicesCordovaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ BleDevicesCordovaComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(BleDevicesCordovaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
