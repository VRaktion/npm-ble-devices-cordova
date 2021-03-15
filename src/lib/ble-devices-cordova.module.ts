import { BleDevicesCordovaService } from './ble-devices-cordova.service';
import { NgModule, ModuleWithProviders, InjectionToken } from '@angular/core';
import { BleDevicesCordovaComponent } from './ble-devices-cordova.component';
import { MicroRouterModule } from '@vraktion/micro-router';
import { CommonModule } from '@angular/common';
import { BleCharacteristicsMap } from './ble-characteristic.model';

export interface LibConfig {
  characteristics: BleCharacteristicsMap
}

export const LibConfigService = new InjectionToken<LibConfig>('LibConfig');

@NgModule({
  declarations: [BleDevicesCordovaComponent],
  imports: [
    MicroRouterModule,
    CommonModule
  ],
  exports: [BleDevicesCordovaComponent]
})
export class BleDevicesCordovaModule {
  static forRoot(config: LibConfig): ModuleWithProviders<BleDevicesCordovaModule> {
    return {
      ngModule: BleDevicesCordovaModule,
      providers: [
        BleDevicesCordovaService,
        {
          provide: LibConfigService,
          useValue: config
        }
      ]
    }
  }
}
