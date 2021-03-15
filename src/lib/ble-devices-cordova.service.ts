import { BLE } from '@ionic-native/ble/ngx';
import { CharacteristicDataTypes } from './characteristic-data-types.enum';
import { NotifyModes } from './notify-modes.enum';
import { Inject, Injectable } from '@angular/core';
import { LibConfigService, LibConfig } from './ble-devices-cordova.module'
import { MicroRouterService } from '@vraktion/micro-router';
import { Platform } from '@ionic/angular';
import { delay, filter, map, takeUntil, tap, distinctUntilChanged, catchError } from 'rxjs/operators';
import { Observable, of, Subject } from 'rxjs';
import { advertisementData } from './advertising-data.model';
import { AdvertisingDataTypes } from './advertising-data-types.enum';
import { RunningNotification } from './running-notifications.model';
import { Mutex } from 'async-mutex';

const bleMutex = new Mutex();


@Injectable({
  providedIn: 'root'
})
export class BleDevicesCordovaService {
  characteristics = this.config.characteristics;
  public scannedDevices: any[] = []
  public connectedDevices: any[] = []
  endScan$ = new Subject<boolean>();
  public disconnectionEvent$ = new Subject<any>();
  public cleanupEvent$ = new Subject();
  public connectionEvent$ = new Subject<any>();

  private runningNotifications: RunningNotification[] = []


  constructor(
    @Inject(LibConfigService) private config: LibConfig,
    private ble: BLE,
    private mR: MicroRouterService,
    private platform: Platform
  ) {
    console.log("BleDevicesCordovaService Config: ", config);
    window.addEventListener("beforeunload", () => {
      // number of miliseconds to hold before unloading page
      let x = 500;
      let a = (new Date()).getTime() + x;
      this.cleanupEvent$.next()

      while ((new Date()).getTime() < a) { }
      this.disconnectAll()
      a += x;
      while ((new Date()).getTime() < a) { }
    }, false)
  }



  async initBle() {
    console.log("enable ble")
    await this.ble.enable()
    console.log("ble enabled")

    this.connectionEvent$
      .pipe(
        delay(100),
        tap((device: any) => {
          this.setNotifyAll(device.id);
        })
      )
      .subscribe()
  }


  async timeout(ms: number) {
    new Promise(res => setTimeout(res, ms))
  }

  parseAdvertisement(buffer: ArrayBuffer): advertisementData {
    let bytes = new Uint8Array(buffer)
    let i = 0;
    let res: advertisementData = {}//{[key: number]: Uint8Array}
    while (i < buffer.byteLength && bytes[i] !== 0x00) {
      let l = bytes[i];
      let index = bytes[i + 1] as number;
      let data = bytes.slice(i + 2, i + l + 1);
      i += l + 1;
      res[index as AdvertisingDataTypes] = data;
    }
    return res;
  }

  buf2hex(buffer: ArrayBuffer): string { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16).toUpperCase()).slice(-2)).join('');
  }

  scanForServices(services: string[]): Observable<any> {
    return this.startScan(services)
  }

  scanForName(name: string): Observable<any> {
    this.scannedDevices = [] //clear list
    return this.ble.startScan([])
      .pipe(
        filter((device: any) => device.name === name),
        tap(async (scanResult: any) => {
          let found = this.connectedDevices.find(function (element) { //check if device is already connected
            return element.device.deviceId == scanResult.device.deviceId;
          })
          if (!found) {
            scanResult.manufacturerData = this.getManufacturerData(scanResult)
            console.log(scanResult)
            this.scannedDevices.push(scanResult)
          }
        }),
        takeUntil(this.endScan$),
      )
  }

  startScan(services: string[]): Observable<any> {
    this.scannedDevices = [] //clear list
    return this.ble.startScan(services)
      .pipe(
        tap(async (scanResult: any) => {
          let found = this.connectedDevices.find(function (element) { //check if device is already connected
            return element.device.deviceId == scanResult.device.deviceId;
          })
          if (!found) {
            scanResult.manufacturerData = this.getManufacturerData(scanResult)
            this.scannedDevices.push(scanResult)
          }
        }),
        takeUntil(this.endScan$),
      )
  }

  async stopScan() {
    await this.ble.stopScan()
      .then(() => {
        this.endScan$.next(true)
        console.log("ble scanning stopped")
      })
      .catch((err) => {
        console.error("error stop ble scanning " + err)
      })
  }

  getManufacturerData(device: any): Uint8Array | undefined {
    let advData, manufacturerData
    if (this.platform.is("android")) {
      advData = new Uint8Array(device.advertising)
      manufacturerData = this.getAndroidManufacturerData(advData)
    } else if (this.platform.is("ios")) {
      advData = device.advertising
      manufacturerData = new Uint8Array(advData.kCBAdvDataManufacturerData)
    }
    if (manufacturerData !== undefined) {
      console.log("manufacturer data: " + this.buf2hex(manufacturerData.buffer))
    } else {
      console.log("manufacturer data undefined")
    }
    return manufacturerData
  }

  getAndroidManufacturerData(advData: Uint8Array): Uint8Array | undefined {
    let i = 0
    while (advData[i + 1] != 0xff && i <= advData.length) {
      i += advData[i] + 1
    }
    if (advData[i + 1] == 0xff) {
      return advData.slice(i + 2, i + advData[i] + 1)

    } else {
      return undefined
    }
  }

  async connectDevice(deviceId: string, connectCb: (device: any) => void, disconnectCb: (device: any) => void) {
    if (deviceId != "undefined") {

      await this.ble.connect(deviceId).subscribe(
        device => {
          console.log("connecting " + deviceId)
          let i = this.scannedDevices.findIndex((element) => {
            return element.id == device.id;
          })
          if (i != -1) {
            device.manufacturerData = this.scannedDevices[i].manufacturerData
            this.scannedDevices.splice(i, 1)//remove from scanned devices
          }
          this.connectedDevices.push(device)//add to connected devices
          this.connectionEvent$.next(device)
          this.setNotifyAll(device.id);
          connectCb(device)
        },
        device => {
          console.log("device " + device.id + " disconnected")
          let i = this.connectedDevices.findIndex((element) => {
            return element.id == device.id;
          })
          if (i != -1) {
            this.connectedDevices.splice(i, 1)//remove from connected devices
            disconnectCb(device)
            this.stopAllRunningNotifications(device.id)
            this.disconnectionEvent$.next(device);
          } else {
            console.error("disconnected device not found in connection list")
          }

        })
    }
  }

  async autoconnectDevice(deviceId: string, connectCb: (device: any) => void, disconnectCb: (device: any) => void) {
    if (deviceId != "undefined") {
      //check for already connected
      // let found = this.connectedDevices.find(function (element) {
      //   return element.id == deviceId;
      // })
      //TODO: save configuration together with DeviceID
      await this.ble.autoConnect(deviceId,
        (device: any) => {
          console.log("connect subscribe " + JSON.stringify(device))
          this.connectedDevices.push(device)//add to connected devices
          connectCb(device)
        }, (device: any) => {
          console.log("device " + device.id + " disconnected")
          let i = this.connectedDevices.findIndex((element) => {
            return element.id == device.id;
          })
          if (i != -1) {
            this.connectedDevices.splice(i, 1)//remove from connected devices
          }
          disconnectCb(device)
        })
    }
  }

  async disconnectDeviceWithId(deviceId: string) {
    if (deviceId != "undefined") {
      let i = this.connectedDevices.findIndex((element) => {
        return element.id == deviceId;
      })
      if (i != -1) {
        await this.ble.disconnect(deviceId).then(
          () => {
            console.log('Disconnected ' + JSON.stringify(deviceId))
            this.connectedDevices.splice(i, 1);//remove element
          },
          () => {
            console.error('ERROR disconnecting ' + JSON.stringify(deviceId))
          })
      } else {
        console.warn('Device is not connected')
      }
    }
  }

  async disconnectDevice(device: any): Promise<any> {
    let i = this.connectedDevices.findIndex((element) => {
      return element.id == device.id;
    })
    if (i != -1) {
      await this.ble.disconnect(device.id).then(
        () => {
          console.log('Disconnected ' + JSON.stringify(device.id))
          this.connectedDevices.splice(i, 1);//remove element
        },
        () => {
          console.error('ERROR disconnecting ' + JSON.stringify(device.id))
        })
    } else {
      console.warn('Device is not connected')
    }
  }

  read(characteristic: string, deviceId: string): Promise<any> {
    console.log("read " + characteristic + " " + deviceId)
    return new Promise(resolve => {
      let i = this.connectedDevices.findIndex((element) => {
        return element.id == deviceId;
      })
      if (i != -1) {
        this.ble.read(
          deviceId,
          this.characteristics[characteristic].service,
          this.characteristics[characteristic].uuid)
          .then((buffer) => {
            resolve(this.bufferToCharData(
              buffer,
              characteristic))
          })
      }
      else {
        resolve(0)
      }
    })
  }

  async write(characteristic: string, deviceId: string, data: any) {
    console.log("write " + characteristic + " " + deviceId)
    let i = this.connectedDevices.findIndex((element) => {
      return element.id == deviceId;
    })
    if (i != -1) {
      return await this.writeCharacteristicBuffer(
        deviceId,
        characteristic,
        this.charDataToBuffer(data, characteristic))
    } else {
      console.warn("device not connected")
    }
  }

  async writeCharacteristicBuffer(
    deviceId: string,
    char: string,
    buffer: ArrayBuffer | undefined
  ) {
    if (deviceId != "undefined") {

      let i = this.connectedDevices.findIndex(function (element) {
        return element.id == deviceId;
      })

      if (i != -1) {
        if (this.characteristics[char].writeable) {
          console.log("write id " + deviceId + " service "
            + this.characteristics[char].service + " char "
            + this.characteristics[char].uuid)

          return await this.ble.write(
            deviceId,
            this.characteristics[char].service,
            this.characteristics[char].uuid,
            <ArrayBuffer>buffer)
        } else {
          console.error('characteristic ' + this.characteristics[char].name + ' not writable')
        }
      } else {
        console.warn("device not connected")
      }
    }
  }

  notificationIsRunning(char: string, deviceId: string): number {
    return this.runningNotifications.findIndex((element) => {
      return (element.deviceId === deviceId) && (element.characteristic === char);
    })
  }

  pushRunningNotification(char: string, deviceId: string) {
    // console.warn("Running Notifications before push " + JSON.stringify(this.runningNotifications))
    if (this.notificationIsRunning(char, deviceId) === -1) {
      this.runningNotifications.push({
        characteristic: char,
        deviceId: deviceId
      })
      // console.warn("Running Notifications after push " + JSON.stringify(this.runningNotifications))
    }
  }

  popRunningNotification(char: string, deviceId: string) {
    let i = this.notificationIsRunning(char, deviceId)
    // console.warn("Running Notifications before pop " + JSON.stringify(this.runningNotifications))
    if (i !== -1) {
      this.runningNotifications.splice(i, 1)
    }
    // console.warn("Running Notifications after pop " + JSON.stringify(this.runningNotifications))
  }

  stopAllRunningNotifications(deviceId: string) {
    // console.warn("Running Notifications before stop " + JSON.stringify(this.runningNotifications))

    let list: RunningNotification[] = JSON.parse(JSON.stringify(this.runningNotifications))
    list.forEach(async element => {
      if (element.deviceId === deviceId) {
        await this.stopNotification(element.characteristic, deviceId)//deletes entry from this.runningNotifications
      }
    })

    // console.warn("Running Notifications after stop " + JSON.stringify(this.runningNotifications))
  }

  async startNotification(
    char: string,
    deviceId: string,
    successFn: (data: any) => void
  ) {
    console.log("start Notification " + Date.now())
    bleMutex.runExclusive(async () => {
      if (deviceId !== "undefined") {
        if (this.notificationIsRunning(char, deviceId) === -1) {
          console.log()
          this.pushRunningNotification(char, deviceId)
          console.log("start notification id" + deviceId + " char " + char)

          return await this.ble.startNotification(
            deviceId,
            this.characteristics[char].service,
            this.characteristics[char].uuid)
            .pipe(
              catchError(val => of(`Notification Error: ${val}`)),
              tap((buffer: any) => {
                successFn(this.bufferToCharData(buffer[0], char))
              }),
              takeUntil(this.disconnectionEvent$)
            )
            .subscribe()
        }
        else {
          throw new Error("notification already running");
        }
      } else {
        throw new Error("ble device undefined");
      }
    })
      .catch(err => console.warn(err))
  }

  async stopNotification(
    char: string,
    deviceId: string,
  ) {
    if (deviceId !== "undefined") {
      if (this.notificationIsRunning(char, deviceId) !== -1) {
        this.popRunningNotification(char, deviceId)
        return await this.ble.stopNotification(
          deviceId,
          this.characteristics[char].service,
          this.characteristics[char].uuid)
          .catch(err => console.warn(err))
      }
    }
  }

  bufferToCharData(buffer: ArrayBuffer, char: string): any {
    let data = new DataView(buffer);//Uint8Array
    let value: any
    switch (this.characteristics[char].dataFormat) {
      case CharacteristicDataTypes.Hexstring:
        value = ""
        for (let i = 0; i < data.byteLength; i++) {
          const stringPart = data.getUint8(i).toString(16).toUpperCase()
          if (stringPart.length < 2) {
            value += "0"
          }
          value += stringPart
        }
        break;
      case CharacteristicDataTypes.String:
        const decoder = new TextDecoder("utf-8")
        value = decoder.decode(data)
        break;
      case CharacteristicDataTypes.Int8:
        value = data.getInt8(0)
        break;
      case CharacteristicDataTypes.Int8Array:
        value = []
        for (let i = 0; i < data.byteLength; i++) {
          value.push(data.getInt8(i))
        }
        break;
      case CharacteristicDataTypes.Uint8:
        value = data.getInt8(0)
        break;
      case CharacteristicDataTypes.Uint8Array:
        value = []
        for (let i = 0; i < data.byteLength; i++) {
          value.push(data.getUint8(i))
        }
        break;
      case CharacteristicDataTypes.Int16:
        value = data.getInt16(0, true)
        break;
      case CharacteristicDataTypes.Int16Array:
        value = []
        for (let i = 0; i < data.byteLength / 2; i++) {
          value.push(data.getInt16(2 * i, true))
        }
        break;
      case CharacteristicDataTypes.Uint16:
        value = data.getUint16(0, true)
        break;
      case CharacteristicDataTypes.Uint16Array:
        value = []
        for (let i = 0; i < data.byteLength / 2; i++) {
          value.push(data.getUint16(2 * i, true))
        }
        break;
      case CharacteristicDataTypes.Int32:
        value = data.getInt32(0, true)
        break;
      case CharacteristicDataTypes.Int32Array:
        value = []
        for (let i = 0; i < data.byteLength / 4; i++) {
          value.push(data.getInt32(4 * i, true))
        }
        break
      case CharacteristicDataTypes.Float32:
        value = data.getFloat32(0, true)
        break;
      case CharacteristicDataTypes.Float32Array:
        value = []
        for (let i = 0; i < data.byteLength / 4; i++) {
          value.push(data.getFloat32(4 * i, true))
        }
        break;
      default:
        console.warn('convert type not implemented')
        return null
    }
    return value;
  }

  charDataToBuffer(data: any, char: string): ArrayBuffer | undefined {
    switch (this.characteristics[char].dataFormat) {
      case CharacteristicDataTypes.Hexstring:
        return new Uint8Array(this.hexToBytes(data)).buffer
      case CharacteristicDataTypes.String:
        const encoder = new TextEncoder()
        return encoder.encode(data).buffer
      case CharacteristicDataTypes.Int8:
        return new Int8Array([data]).buffer
      case CharacteristicDataTypes.Int8Array:
        return new Int8Array(data).buffer
      case CharacteristicDataTypes.Uint8:
        return new Uint8Array([data]).buffer
      case CharacteristicDataTypes.Uint8Array:
        return new Uint8Array(data).buffer
      case CharacteristicDataTypes.Int16:
        return new Int16Array([data]).buffer
      case CharacteristicDataTypes.Int16Array:
        return new Int16Array(data).buffer
      case CharacteristicDataTypes.Uint16:
        return new Uint16Array([data]).buffer
      case CharacteristicDataTypes.Uint16Array:
        return new Uint16Array(data).buffer
      case CharacteristicDataTypes.Int32:
        return new Int32Array([data]).buffer
      case CharacteristicDataTypes.Int32Array:
        return new Int32Array(data).buffer
      case CharacteristicDataTypes.Float32:
        return new Float32Array([data]).buffer
      case CharacteristicDataTypes.Float32:
        return new Float32Array(data).buffer
      default:
        console.warn('convert type not implemented')
        return undefined;
    }
  }

  hexToBytes(hex: string): number[] {
    let bytes = []
    for (let c = 0; c < hex.length; c += 2) {
      bytes.push(parseInt(hex.substr(c, 2), 16));
    }
    return bytes;
    // return new Uint8Array(bytes).buffer;
  }

  async disconnectAll() {
    for (let element of this.connectedDevices) {
      console.log("disconnect from " + element.device.deviceId)
      await this.disconnectDevice(element.device.deviceId)
    }
  }

  async setNotifyAll(deviceId: string) {
    console.log("notify all: " + deviceId)
    for (const [key, value] of Object.entries(this.characteristics)) {
      console.log(key, value);
      // await this.stopNotification(key, deviceId)//stop previous notifications after livereload
      switch (value.notifiable) {
        case NotifyModes.None:
          console.log("none");
          break;
        case NotifyModes.Cold:
          console.log("cold");
          this.startNotifyCold(key, deviceId);
          break;
        case NotifyModes.Hot:
          console.log("hot");
          this.startNotify(key, deviceId);
          break;
      }
    }
  }

  startNotifyCold(characteristic: string, deviceId: string) {

    this.mR.startCb(
      characteristic,
      deviceId)
      .pipe(
        tap(() => {
          this.startNotify(characteristic, deviceId)
        })
      )
      .subscribe()

    this.mR.stopCb(
      characteristic,
      deviceId)
      .pipe(
        tap(() => {
          this.stopNotify(characteristic, deviceId)
        })
      )
      .subscribe()
  }

  async startNotify(characteristic: string, deviceId: string) {
    console.log("[notify] id " + deviceId + " char: " + characteristic + " <started>")
    await this.read(characteristic, deviceId)
      .then(data => {
        this.mR.set(characteristic, deviceId, data)
      })
    await this.startNotification(characteristic, deviceId,
      (data) => {
        this.mR.set(characteristic, deviceId, data)
      })
  }

  stopNotify(characteristic: string, deviceId: string) {
    if (deviceId !== undefined && characteristic !== undefined) {
      console.log("[notify] " + deviceId + ":" + characteristic + " <stopped>")
      this.stopNotification(characteristic, deviceId)
    }
  }

  notify(characteristic: string, deviceId: string): Observable<any> {
    // console.log("[notify] " + characteristic + " " + deviceId)
    return this.mR.get(characteristic, deviceId)
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntil(this.cleanupEvent$),
      )
  }


  autoConnectManufacturerId(deviceName: string, manufacturerId: string) {

    this.getDeviceIdFromManufacturerId(deviceName, manufacturerId)
      .pipe(
        tap(async (deviceId: string) => {
          this.connectDevice(deviceId,
            () => { },
            () => {//disconnect callback
              this.autoConnectManufacturerId(deviceName, manufacturerId)
            })
        })
      )
      .subscribe()
  }

  autoConnect(deviceId: string) {
    this.connectDevice(deviceId,
      () => { },//connect callback
      () => {//disconnect callback
        this.autoConnect(deviceId)
      })
  }

  getDeviceIdFromManufacturerId(name: string, manufacturerId: string): Observable<string> {
    return this.scanForName(name)
      .pipe(
        filter((res: any) => this.buf2hex(res.manufacturerData.buffer) === manufacturerId),
        tap(() => this.stopScan()),
        map((res: any) => res.id)
      )
  }

  manufacturerIdFromScanResult(res: any): string {
    if (res.rawAdvertisement !== undefined) {
      let advData = this.parseAdvertisement(res.rawAdvertisement.buffer)
      if (advData[AdvertisingDataTypes.ManufacturerData] !== undefined) {
        return this.buf2hex(advData[AdvertisingDataTypes.ManufacturerData]!)
      } else {
        return ''
      }
    } else {
      console.warn("no adv data")
      return ''
    }

  }
}
