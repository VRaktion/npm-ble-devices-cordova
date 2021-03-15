import {NotifyModes} from './notify-modes.enum'
import {CharacteristicDataTypes} from './characteristic-data-types.enum'

export interface BleCharacteristic {
    name: string;
    service: string;
    uuid: string;
    dataFormat: CharacteristicDataTypes;
    readable: boolean;
    writeable: boolean;
    notifiable: NotifyModes;
}

export interface BleCharacteristicsMap {
    [id: string]: BleCharacteristic;
}