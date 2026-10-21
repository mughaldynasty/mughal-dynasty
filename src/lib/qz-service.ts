import qz from 'qz-tray';

class QZService {
  private connected = false;

  async connect() {
    if (this.connected) return;
    
    try {
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect();
        this.connected = true;
        console.log('QZ Tray connected');
      }
    } catch (err) {
      console.error('QZ Tray connection failed:', err);
      throw err;
    }
  }

  async findPrinter(printerName: string) {
    await this.connect();
    try {
      return await qz.printers.find(printerName);
    } catch (err) {
      console.error('Printer not found:', err);
      throw err;
    }
  }

  async printHTML(printerName: string, html: string) {
    try {
      await this.connect();
      const config = qz.configs.create(printerName);
      
      const data = [{
        type: 'pixel',
        format: 'html',
        flavor: 'plain',
        data: html
      }];

      await qz.print(config, data);
    } catch (err) {
      console.error('Print failed:', err);
      throw err;
    }
  }

  async listPrinters() {
    await this.connect();
    return await qz.printers.find();
  }
}

export const qzService = new QZService();
