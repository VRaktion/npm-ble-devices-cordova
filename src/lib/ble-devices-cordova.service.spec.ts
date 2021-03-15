import { TestBed } from '@angular/core/testing';

import { BleDevicesCordovaService } from './ble-devices-cordova.service';

describe('BleDevicesCordovaService', () => {
  let service: BleDevicesCordovaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BleDevicesCordovaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
