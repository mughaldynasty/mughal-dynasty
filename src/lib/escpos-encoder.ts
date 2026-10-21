
export class EscPosEncoder {
  private buffer: Uint8Array = new Uint8Array(0);
  private encoder = new TextEncoder();

  private append(data: string | Uint8Array) {
    let newData: Uint8Array;
    if (typeof data === 'string') {
      // We use a custom mapping for the £ symbol to ensure it's sent as a single byte 0x9C
      // while other characters are encoded as UTF-8 (or ASCII if they fit)
      const bytes: number[] = [];
      for (let i = 0; i < data.length; i++) {
        const charCode = data.charCodeAt(i);
        if (data[i] === '£') {
          bytes.push(0x9C); // PC850 Pound symbol
        } else if (charCode < 128) {
          bytes.push(charCode);
        } else {
          // Fallback to UTF-8 for other special chars
          const encoded = this.encoder.encode(data[i]);
          encoded.forEach(b => bytes.push(b));
        }
      }
      newData = new Uint8Array(bytes);
    } else {
      newData = data;
    }
    
    const combined = new Uint8Array(this.buffer.length + newData.length);
    combined.set(this.buffer);
    combined.set(newData, this.buffer.length);
    this.buffer = combined;
  }

  initialize() { 
    this.append('\x1B@'); 
    // Set character table to PC850 (Multilingual)
    this.append(new Uint8Array([0x1B, 0x74, 0x02])); 
    return this; 
  }
  
  font(type: 'A' | 'B') {
    this.append(new Uint8Array([0x1B, 0x4D, type === 'A' ? 0x00 : 0x01]));
    return this;
  }

  bold(on: boolean) { 
    this.append(new Uint8Array([0x1B, 0x45, on ? 0x01 : 0x00])); 
    return this; 
  }

  italic(on: boolean) {
    // Some printers use ESC 4/5, others use ESC ! bit 6
    // We'll try to use ESC ! (Select print mode) bit 6 for italic
    // Bit 6 is 64 (0x40)
    // Warning: ESC ! replaces previous sizing/bolding if not careful.
    // However, our size() and bold() use ESC E and GS ! which are separate.
    this.append(new Uint8Array([0x1B, 0x21, on ? 0x40 : 0x00]));
    return this;
  }

  underline(on: boolean) {
    this.append(new Uint8Array([0x1B, 0x2D, on ? 0x01 : 0x00]));
    return this;
  }

  currency(amount: number) {
    this.append('£' + amount.toFixed(2));
    return this;
  }
  
  align(pos: 'left' | 'center' | 'right') {
    const val = pos === 'left' ? 0x00 : pos === 'center' ? 0x01 : 0x02;
    this.append(new Uint8Array([0x1B, 0x61, val]));
    return this;
  }
  
  size(width: number, height: number) {
    // GS ! n
    const n = ((width - 1) << 4) | (height - 1);
    this.append(new Uint8Array([0x1D, 0x21, n]));
    return this;
  }

  line(text: string = '') { 
    this.append(text + '\n'); 
    return this; 
  }

  invert(on: boolean) {
    this.append(new Uint8Array([0x1D, 0x42, on ? 0x01 : 0x00]));
    return this;
  }

  hr() {
    this.append('------------------------------------------\n');
    return this;
  }
  
  text(text: string) {
    this.append(text);
    return this;
  }

  feed(n: number = 3) { 
    this.append('\x1Bd' + String.fromCharCode(n)); 
    return this; 
  }
  
  cut() { 
    // GS V 66 0 - Feed paper and cut
    this.append('\x1DV\x42\x00'); 
    return this; 
  }

  encode() { 
    return this.buffer; 
  }
}
