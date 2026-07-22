import { parentPort, workerData } from 'node:worker_threads';
import {
  extractDriveItemTextInProcess,
  type DriveItemExtractionInput,
} from './drive-item-extractor.js';

void (async () => {
  try {
    const input = workerData as DriveItemExtractionInput;
    input.bytes = Buffer.from(input.bytes);
    const result = await extractDriveItemTextInProcess(input);
    parentPort?.postMessage(result);
  } catch (error) {
    parentPort?.postMessage({ error: (error as Error).message });
  }
})();
