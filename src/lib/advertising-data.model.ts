import { AdvertisingDataTypes } from "./advertising-data-types.enum";

export type advertisementData = {
    [key in AdvertisingDataTypes]?: Uint8Array;
};