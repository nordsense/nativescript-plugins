import { Utils } from '@nativescript/core';
import { NDEFListenerOptions, NfcApi, NfcNdefData, NfcNdefRecord, NfcTagData, NfcUriProtocols, WriteTagOptions, TextRecord, NFCNDEFReaderSessionOptions } from './common';

export interface NfcSessionInvalidator {
  invalidateSession(): void;
}

export class Nfc implements NfcApi, NfcSessionInvalidator {
  private session: NFCNDEFReaderSession;
  private delegate: NFCNDEFReaderSessionDelegateImpl;
  private writeDelegate: NFCNDEFReaderSessionDelegateWriteImpl;
  public message: NFCNDEFMessage;

  private static _available(): boolean {
    const isIOS11OrUp = NSObject.instancesRespondToSelector('accessibilityAttributedLabel');
    if (isIOS11OrUp) {
      try {
        return NFCNDEFReaderSession.readingAvailable;
      } catch (e) {
        return false;
      }
    } else {
      return false;
    }
  }

  public available(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      resolve(Nfc._available());
    });
  }

  public enabled(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      resolve(Nfc._available());
    });
  }

  public setOnTagDiscoveredListener(callback: (data: NfcTagData) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      resolve();
    });
  }

  public setOnNdefDiscoveredListener(callback: (data: NfcNdefData) => void, options?: NDEFListenerOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!Nfc._available()) {
        reject();
        return;
      }

      if (callback === null) {
        this.invalidateSession();
        resolve();
        return;
      }

      try {
        const delegateCallback = (data) => {
          if (!callback) {
            console.log('Ndef discovered, but no listener was set via setOnNdefDiscoveredListener. Ndef: ' + JSON.stringify(data));
          } else {
            Utils.executeOnMainThread(() => {
              return callback(data);
            });
          }
        };
        this.delegate = this.createNFCNDEFReaderSessionDelegate(options, delegateCallback);

        this.beginNFCNDEFReaderSession(this.delegate, options);

        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  invalidateSession(): void {
    if (this.session) {
      this.session.invalidateSession();
      this.session = undefined;
    }
  }

  public stopListening(): Promise<void> {
    return new Promise((resolve, reject) => {
      resolve();
    });
  }

  public writeTag(options: WriteTagOptions): Promise<NfcNdefData> {
    return new Promise((resolve, reject) => {
      if (!Nfc._available()) {
        reject();
        return;
      }
      try {
        this.message = NfcHelper.jsonToNdefRecords(options.textRecords);
        const delegateCallback = (data) => {
          Utils.executeOnMainThread(() => {
            return resolve(data);
          });
        };
        const delegateErrorCallback = (error) => {
          Utils.executeOnMainThread(() => {
            return reject(error);
          });
        };
        this.writeDelegate = this.createNFCNDEFReaderSessionDelegateWrite(options, delegateCallback, delegateErrorCallback);

        this.beginNFCNDEFReaderSession(this.writeDelegate, options);
      } catch (e) {
        reject(e);
      }
    });
  }

  public eraseTag(): Promise<any> {
    return new Promise((resolve, reject) => {
      reject('Not available on iOS');
    });
  }

  private createNFCNDEFReaderSessionDelegate(options?: NDEFListenerOptions, callback?: (data: any) => void) {
    const delegate = NFCNDEFReaderSessionDelegateImpl.createWithOwnerResultCallbackAndOptions(new WeakRef(this), callback, options);
    return delegate;
  }

  private createNFCNDEFReaderSessionDelegateWrite(options?: WriteTagOptions, callback?: (data: any) => void, errorCallback?: (data: any) => void) {
    const delegate = NFCNDEFReaderSessionDelegateWriteImpl.createWithOwnerResultCallbackAndOptions(new WeakRef(this), callback, errorCallback, options);
    return delegate;
  }

  private beginNFCNDEFReaderSession(delegate: NFCNDEFReaderSessionDelegate, options?: NFCNDEFReaderSessionOptions) {
    console.log('Create and begin NFCNDEFReaderSession');

    this.session = NFCNDEFReaderSession.alloc().initWithDelegateQueueInvalidateAfterFirstRead(delegate, null, options && options.stopAfterFirstRead);

    if (options && options.startHint) {
      this.session.alertMessage = options.startHint;
    }

    console.dir(NFCNDEFTag.prototype);
    this.session.beginSession();
  }
}

@NativeClass()
class NFCNDEFReaderSessionDelegateImpl extends NSObject implements NFCNDEFReaderSessionDelegate {
  public static ObjCProtocols = [];

  private _owner: WeakRef<NfcSessionInvalidator>;
  private resultCallback: (message: any) => void;
  private options?: NDEFListenerOptions;

  public static new(): NFCNDEFReaderSessionDelegateImpl {
    try {
      NFCNDEFReaderSessionDelegateImpl.ObjCProtocols.push(NFCNDEFReaderSessionDelegate);
    } catch (ignore) {}
    return <NFCNDEFReaderSessionDelegateImpl>super.new();
  }

  public static createWithOwnerResultCallbackAndOptions(owner: WeakRef<NfcSessionInvalidator>, callback: (message: any) => void, options?: NDEFListenerOptions): NFCNDEFReaderSessionDelegateImpl {
    const delegate = <NFCNDEFReaderSessionDelegateImpl>NFCNDEFReaderSessionDelegateImpl.new();
    delegate._owner = owner;
    delegate.options = options;
    delegate.resultCallback = callback;
    return delegate;
  }

  readerSessionDidBecomeActive(session: NFCNDEFReaderSession): void {
    // ignore, but by implementing this function we suppress a log about it not being implemented ;)
  }

  // Called when the reader session finds a new tag
  readerSessionDidDetectNDEFs(session: NFCNDEFReaderSession, messages: NSArray<NFCNDEFMessage>): void {
    const firstMessage = messages[0];
    if (this.options && this.options.stopAfterFirstRead) {
      setTimeout(() => this._owner.get().invalidateSession());
    }

    // execute on the main thread with this trick
    this.resultCallback(NfcHelper.ndefToJson(firstMessage));
  }

  // Called when the reader session becomes invalid due to the specified error
  readerSessionDidInvalidateWithError(session: any /* NFCNDEFReaderSession */, error: NSError): void {
    this._owner.get().invalidateSession();
  }
}

@NativeClass()
class NFCNDEFReaderSessionDelegateWriteImpl extends NSObject implements NFCNDEFReaderSessionDelegate {
  public static ObjCProtocols = [];

  private _owner: WeakRef<Nfc>;
  private resultCallback: (message: any) => void;
  private errorCallback: (error: any) => void;
  private options?: WriteTagOptions;

  public static new(): NFCNDEFReaderSessionDelegateWriteImpl {
    try {
      NFCNDEFReaderSessionDelegateWriteImpl.ObjCProtocols.push(NFCNDEFReaderSessionDelegate);
    } catch (ignore) {}
    return <NFCNDEFReaderSessionDelegateWriteImpl>super.new();
  }

  public static createWithOwnerResultCallbackAndOptions(owner: WeakRef<Nfc>, callback: (message: any) => void, errorCallback: (error: any) => void, options?: WriteTagOptions): NFCNDEFReaderSessionDelegateWriteImpl {
    let delegate = <NFCNDEFReaderSessionDelegateWriteImpl>NFCNDEFReaderSessionDelegateWriteImpl.new();
    delegate._owner = owner;
    delegate.options = options;
    delegate.resultCallback = callback;
    delegate.errorCallback = errorCallback;
    return delegate;
  }

  readerSessionDidBecomeActive(session: NFCNDEFReaderSession): void {
    // ignore, but by implementing this function we suppress a log about it not being implemented ;)
  }

  // Called when the reader session finds a new tag
  readerSessionDidDetectNDEFs(session: NFCNDEFReaderSession, messages: NSArray<NFCNDEFMessage>): void {}

  readerSessionDidDetectTags(session: NFCNDEFReaderSession, tags: NSArray<NFCNDEFTag> | NFCNDEFTag[]): void {
    const tag = tags[0];

    session.connectToTagCompletionHandler(tag, (error: NSError) => {
      console.log('connectToTagCompletionHandler');

      if (error) {
        console.log(error);
        session.invalidateSessionWithErrorMessage('Unable to connect to tag.');
        this.errorCallback(error);
        return;
      }

      const ndefTag: NFCNDEFTag = new interop.Reference<NFCNDEFTag>(interop.types.id, tag).value;

      try {
        NFCNDEFTag.prototype.queryNDEFStatusWithCompletionHandler.call(ndefTag, (status: NFCNDEFStatus, number: number, error: NSError) => {
          console.log('queryNDEFStatusWithCompletionHandler');
          if (error) {
            console.log(error);
            session.invalidateSessionWithErrorMessage('Unable to query the NDEF status of tag.');
            this.errorCallback(error);
            return;
          }

          switch (status) {
            case NFCNDEFStatus.NotSupported:
              session.invalidateSessionWithErrorMessage('Tag is not NDEF compliant.');
              break;
            case NFCNDEFStatus.ReadOnly:
              session.invalidateSessionWithErrorMessage('Tag is read only.');
              break;
            case NFCNDEFStatus.ReadWrite:
              const ndefMessage = this._owner.get().message;
              NFCNDEFTag.prototype.writeNDEFCompletionHandler.call(ndefTag, ndefMessage, (error: NSError) => {
                if (error) {
                  console.log(error);
                  session.invalidateSessionWithErrorMessage('Write NDEF message failed.');
                  this.errorCallback(error);
                } else {
                  if (ndefMessage.records[0].typeNameFormat == NFCTypeNameFormat.Empty) {
                    session.alertMessage = 'Erased data from NFC tag.';
                  } else {
                    if (this.options.endHint) {
                      session.alertMessage = this.options.endHint;
                    }
                    this.resultCallback(NfcHelper.ndefToJson(ndefMessage));
                  }
                  session.invalidateSession();
                }
              });
              break;
            default:
              session.invalidateSessionWithErrorMessage('Unknown NDEF tag status.');
              break;
          }
        });
      } catch (e) {
        console.log(e);
        session.alertMessage = `Write NDEF message failed: ${e}`;
      }
    });
  }

  // Called when the reader session becomes invalid due to the specified error
  readerSessionDidInvalidateWithError(session: any /* NFCNDEFReaderSession */, error: NSError): void {
    this._owner.get().invalidateSession();
  }
}

class NfcHelper {
  // For write
  public static ndefEmptyMessage(): NFCNDEFMessage {
    let type: NSData = NfcHelper.uint8ArrayToNSData([]);
    let id: NSData = NfcHelper.uint8ArrayToNSData([]);
    const payload: NSData = NfcHelper.uint8ArrayToNSData([]);
    let record = NFCNDEFPayload.alloc().initWithFormatTypeIdentifierPayload(NFCTypeNameFormat.Empty, type, id, payload);
    let records: NSMutableArray<NFCNDEFPayload> = NSMutableArray.new();
    records.addObject(record);
    return NFCNDEFMessage.alloc().initWithNDEFRecords(records);
  }

  public static jsonToNdefRecords(textRecords: TextRecord[]): NFCNDEFMessage {
    let records: NSMutableArray<NFCNDEFPayload> = NSMutableArray.new();

    if (textRecords !== null) {
      textRecords.forEach((textRecord) => {
        let type: NSData = NfcHelper.uint8ArrayToNSData([0x54]);
        let ids = [];
        if (textRecord.id) {
          for (let j = 0; j < textRecord.id.length; j++) {
            ids.push(textRecord.id[j]);
          }
        }
        let id: NSData = NfcHelper.uint8ArrayToNSData(ids);

        let langCode = textRecord.languageCode || 'en';
        let encoded = NfcHelper.stringToBytes(langCode + textRecord.text);
        encoded.unshift(langCode.length); // STX (start of text)

        let payloads = [];
        for (let n = 0; n < encoded.length; n++) {
          payloads[n] = encoded[n];
        }
        const payload: NSData = NfcHelper.uint8ArrayToNSData(payloads);
        let record = NFCNDEFPayload.alloc().initWithFormatTypeIdentifierPayload(NFCTypeNameFormat.NFCWellKnown, type, id, payload);
        records.addObject(record);
      });
    }

    // TODO: implement for URI records

    return NFCNDEFMessage.alloc().initWithNDEFRecords(records);
  }

  private static uint8ArrayToNSData(array): NSData {
    let data: NSMutableData = NSMutableData.alloc().initWithCapacity(array.count);
    for (let item of array) {
      data.appendBytesLength(new interop.Reference(interop.types.uint8, item), 1);
    }
    return data;
  }

  private static stringToBytes(input: string) {
    let bytes = [];
    for (let n = 0; n < input.length; n++) {
      let c = input.charCodeAt(n);
      if (c < 128) {
        bytes[bytes.length] = c;
      } else if (c > 127 && c < 2048) {
        bytes[bytes.length] = (c >> 6) | 192;
        bytes[bytes.length] = (c & 63) | 128;
      } else {
        bytes[bytes.length] = (c >> 12) | 224;
        bytes[bytes.length] = ((c >> 6) & 63) | 128;
        bytes[bytes.length] = (c & 63) | 128;
      }
    }
    return bytes;
  }

  // For write end

  public static ndefToJson(message: NFCNDEFMessage): NfcNdefData {
    if (message === null) {
      return null;
    }

    return {
      message: this.messageToJSON(message),
    };
  }

  public static messageToJSON(message: NFCNDEFMessage): Array<NfcNdefRecord> {
    const result = [];
    for (let i = 0; i < message.records.count; i++) {
      result.push(this.recordToJSON(message.records.objectAtIndex(i)));
    }
    return result;
  }

  private static recordToJSON(record: NFCNDEFPayload): NfcNdefRecord {
    let payloadAsHexArray = this.nsdataToHexArray(record.payload);
    let payloadAsString = this.nsdataToASCIIString(record.payload);
    let payloadAsStringWithPrefix = payloadAsString;
    const recordType = this.nsdataToHexArray(record.type);
    const decimalType = this.hexToDec(recordType[0]);
    if (decimalType === 84) {
      let languageCodeLength: number = +payloadAsHexArray[0];
      payloadAsString = payloadAsStringWithPrefix.substring(languageCodeLength + 1);
    } else if (decimalType === 85) {
      let prefix = NfcUriProtocols[payloadAsHexArray[0]];
      if (!prefix) {
        prefix = '';
      }
      payloadAsString = prefix + payloadAsString.slice(1);
    }

    return {
      tnf: record.typeNameFormat, // "typeNameFormat" (1 = well known) - see https://developer.apple.com/documentation/corenfc/nfctypenameformat?changes=latest_major&language=objc
      type: decimalType,
      id: this.hexToDecArray(this.nsdataToHexArray(record.identifier)),
      payload: this.hexToDecArray(payloadAsHexArray),
      payloadAsHexString: this.nsdataToHexString(record.payload),
      payloadAsStringWithPrefix: payloadAsStringWithPrefix,
      payloadAsString: payloadAsString,
    };
  }

  private static hexToDec(hex) {
    if (hex === undefined) {
      return undefined;
    }

    let result = 0,
      digitValue;
    hex = hex.toLowerCase();
    for (let i = 0; i < hex.length; i++) {
      digitValue = '0123456789abcdefgh'.indexOf(hex[i]);
      result = result * 16 + digitValue;
    }
    return result;
  }

  private static buf2hexString(buffer) {
    // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x) => ('00' + x.toString(16)).slice(-2)).join('');
  }

  private static buf2hexArray(buffer) {
    // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x) => ('00' + x.toString(16)).slice(-2));
  }

  private static hex2a(hexx) {
    const hex = hexx.toString(); // force conversion
    let str = '';
    for (let i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
  }

  private static nsdataToHexString(data): string {
    let b = interop.bufferFromData(data);
    return this.buf2hexString(b);
  }

  private static nsdataToHexArray(data): Array<string> {
    let b = interop.bufferFromData(data);
    return this.buf2hexArray(b);
  }

  private static nsdataToASCIIString(data): string {
    return this.hex2a(this.nsdataToHexString(data));
  }

  private static hexToDecArray(hexArray): any {
    let resultArray = [];
    for (let i = 0; i < hexArray.length; i++) {
      let result = 0,
        digitValue;
      const hex = hexArray[i].toLowerCase();
      for (let j = 0; j < hex.length; j++) {
        digitValue = '0123456789abcdefgh'.indexOf(hex[j]);
        result = result * 16 + digitValue;
      }
      resultArray.push(result);
    }
    return JSON.stringify(resultArray);
  }
}