
export class BluetoothPrinterService {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  async connect() {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ['000018f0-0000-1000-8000-00805f9b34fb'] }, // Common thermal printer service
          { namePrefix: 'TP' },
          { namePrefix: 'MTP' },
          { namePrefix: 'InnerPrinter' },
          { namePrefix: 'BlueTooth' },
          { namePrefix: 'Printer' }
        ],
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
      });

      const server = await this.device.gatt?.connect();
      const service = await server?.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristics = await service?.getCharacteristics();
      
      // Usually the first characteristic that supports write is the one
      this.characteristic = characteristics?.find(c => c.properties.write || c.properties.writeWithoutResponse) || null;

      if (!this.characteristic) {
        throw new Error('No writeable characteristic found');
      }

      return this.device.name;
    } catch (err) {
      console.error('Bluetooth connection failed:', err);
      throw err;
    }
  }

  async print(data: Uint8Array) {
    if (!this.characteristic) {
      throw new Error('Printer not connected');
    }

    // Split data into chunks (Bluetooth has MTU limits, usually 20-512 bytes)
    const CHUNK_SIZE = 20; 
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await this.characteristic.writeValue(chunk);
    }
  }

  isConnected() {
    return !!this.characteristic && this.device?.gatt?.connected;
  }
}

export const bluetoothPrinter = new BluetoothPrinterService();
