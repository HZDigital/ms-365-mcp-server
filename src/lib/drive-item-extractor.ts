import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { OfficeParser, type OfficeContentNode, type SupportedFileType } from 'officeparser';

const nodeRequire = createRequire(import.meta.url);

export interface DriveItemExtractionInput {
  bytes: Buffer;
  name: string;
  mimeType?: string;
  maxCharacters: number;
}

export interface DriveItemExtractionResult {
  text: string;
  truncated: boolean;
}

type ExtractionFormat = 'pdf' | 'docx' | 'presentation' | 'spreadsheet' | 'text';

const EXTRACTION_TIMEOUT_MS = 30_000;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_TABLE_CELLS = 100_000;
const EXTRACTION_WORKER_MAX_OLD_SPACE_MB = 128;
const EXTRACTION_WORKER_MAX_YOUNG_SPACE_MB = 32;
const MAX_CONCURRENT_EXTRACTION_WORKERS = 2;
let activeExtractionWorkers = 0;

const TEXT_EXTENSIONS = new Set([
  'csv',
  'html',
  'htm',
  'json',
  'md',
  'markdown',
  'rst',
  'text',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

function extensionFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function normalizeMimeType(mimeType?: string): string {
  return mimeType?.split(';', 1)[0].trim().toLowerCase() ?? '';
}

function detectExtractionFormat(name: string, mimeType?: string): ExtractionFormat | undefined {
  const extension = extensionFromName(name);
  const mime = normalizeMimeType(mimeType);

  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (
    mime.includes('wordprocessingml.document') ||
    mime.includes('wordprocessingml.template') ||
    extension === 'docx' ||
    extension === 'dotx'
  ) {
    return 'docx';
  }
  if (
    mime.includes('presentationml.presentation') ||
    mime.includes('presentationml.template') ||
    extension === 'pptx' ||
    extension === 'potx'
  ) {
    return 'presentation';
  }
  if (mime.includes('spreadsheetml') || extension === 'xlsx') {
    return 'spreadsheet';
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-yaml' ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return 'text';
  }
  return undefined;
}

function fileTypeForFormat(format: Exclude<ExtractionFormat, 'text'>): SupportedFileType {
  switch (format) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'presentation':
      return 'pptx';
    case 'spreadsheet':
      return 'xlsx';
  }
}

function appendText(
  chunks: string[],
  state: { length: number; truncated: boolean },
  value: string,
  maxCharacters: number
): boolean {
  if (state.truncated || value.length === 0) return !state.truncated;
  const remaining = maxCharacters - state.length;
  if (remaining <= 0) {
    state.truncated = true;
    return false;
  }
  if (value.length > remaining) {
    chunks.push(value.slice(0, remaining));
    state.length += remaining;
    state.truncated = true;
    return false;
  }
  chunks.push(value);
  state.length += value.length;
  return true;
}

function isBlockNode(node: OfficeContentNode): boolean {
  return [
    'paragraph',
    'heading',
    'table',
    'row',
    'cell',
    'list',
    'slide',
    'page',
    'sheet',
    'note',
    'code',
  ].includes(node.type);
}

function textFromAst(nodes: OfficeContentNode[], maxCharacters: number): DriveItemExtractionResult {
  const chunks: string[] = [];
  const state = { length: 0, truncated: false };

  const visit = (node: OfficeContentNode): boolean => {
    const children = node.children ?? [];
    if (children.length > 0) {
      for (const child of children) {
        if (!visit(child)) return false;
      }
    } else if (node.text && !appendText(chunks, state, node.text, maxCharacters)) {
      return false;
    }

    return !isBlockNode(node) || appendText(chunks, state, '\n', maxCharacters);
  };

  for (const node of nodes) {
    if (!visit(node)) break;
  }
  return { text: chunks.join(''), truncated: state.truncated };
}

function textFromBuffer(bytes: Buffer, maxCharacters: number): DriveItemExtractionResult {
  const decoded = bytes.toString('utf8');
  return {
    text: decoded.slice(0, maxCharacters),
    truncated: decoded.length > maxCharacters,
  };
}

async function extractOfficeText(
  bytes: Buffer,
  format: Exclude<ExtractionFormat, 'text'>,
  maxCharacters: number
): Promise<DriveItemExtractionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const document = await OfficeParser.parseOffice(bytes, {
      abortSignal: controller.signal,
      extractAttachments: false,
      includeRawContent: false,
      ignoreComments: true,
      ignoreHeadersAndFooters: true,
      ignoreNotes: true,
      ignoreSlideMasters: true,
      ocr: false,
      fileType: fileTypeForFormat(format),
      decompressionLimits: {
        maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
        maxZipEntries: MAX_ZIP_ENTRIES,
        maxTableCells: MAX_TABLE_CELLS,
      },
    });
    // Avoid ast.toText(), which builds one unbounded string before the caller
    // can apply its model-output limit. Walking leaf nodes stops at the cap.
    return textFromAst(document.content, maxCharacters);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Text extraction timed out after ${EXTRACTION_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extracts text only from document formats whose parsers are explicitly loaded.
 * Callers must enforce byte and output limits before exposing the result to an LLM.
 */
export async function extractDriveItemTextInProcess({
  bytes,
  name,
  mimeType,
  maxCharacters,
}: DriveItemExtractionInput): Promise<DriveItemExtractionResult> {
  const format = detectExtractionFormat(name, mimeType);
  if (!format) {
    throw new Error(
      `Unsupported file type '${mimeType || 'unknown'}' for '${name}'. Supported formats are PDF, DOCX, PPTX, XLSX, CSV, and text files.`
    );
  }

  if (format === 'text') return textFromBuffer(bytes, maxCharacters);
  return extractOfficeText(bytes, format, maxCharacters);
}

function extractionWorkerUrl(): URL {
  const entryUrl = new URL(
    import.meta.url.endsWith('.ts')
      ? './drive-item-extractor-worker.ts'
      : './drive-item-extractor-worker.js',
    import.meta.url
  );
  if (!import.meta.url.endsWith('.ts')) return entryUrl;

  // Node does not apply --import hooks to a worker's TypeScript entry point.
  // Boot source-mode workers from JavaScript and let tsx import the entry.
  const tsxApiUrl = pathToFileURL(nodeRequire.resolve('tsx/esm/api')).href;
  const source = [
    `import { tsImport } from ${JSON.stringify(tsxApiUrl)};`,
    `await tsImport(${JSON.stringify(entryUrl.href)}, import.meta.url);`,
  ].join('\n');
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

async function extractOfficeTextInWorker(
  input: DriveItemExtractionInput
): Promise<DriveItemExtractionResult> {
  if (activeExtractionWorkers >= MAX_CONCURRENT_EXTRACTION_WORKERS) {
    throw new Error('Document extraction is at capacity. Retry the request shortly.');
  }
  activeExtractionWorkers += 1;

  return new Promise<DriveItemExtractionResult>((resolve, reject) => {
    const worker = new Worker(extractionWorkerUrl(), {
      workerData: input,
      resourceLimits: {
        maxOldGenerationSizeMb: EXTRACTION_WORKER_MAX_OLD_SPACE_MB,
        maxYoungGenerationSizeMb: EXTRACTION_WORKER_MAX_YOUNG_SPACE_MB,
      },
    });
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      settle(() =>
        reject(
          new Error(`Text extraction timed out after ${EXTRACTION_TIMEOUT_MS / 1000} seconds.`)
        )
      );
    }, EXTRACTION_TIMEOUT_MS);

    worker.once('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'text' in message &&
        typeof (message as DriveItemExtractionResult).text === 'string' &&
        'truncated' in message &&
        typeof (message as DriveItemExtractionResult).truncated === 'boolean'
      ) {
        settle(() => resolve(message as DriveItemExtractionResult));
        return;
      }
      const error =
        typeof message === 'object' && message !== null && 'error' in message
          ? (message as { error: unknown }).error
          : 'Document extraction worker returned an invalid response.';
      settle(() => reject(new Error(String(error))));
    });
    worker.once('error', (error) => settle(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0) {
        settle(() =>
          reject(
            new Error(`Document extraction worker stopped unexpectedly with exit code ${code}.`)
          )
        );
      }
    });
  }).finally(() => {
    activeExtractionWorkers -= 1;
  });
}

/**
 * Extracts text from a bounded document in an isolated worker. Callers must
 * still enforce a byte limit before passing the file into this function.
 */
export async function extractDriveItemText(
  input: DriveItemExtractionInput
): Promise<DriveItemExtractionResult> {
  const format = detectExtractionFormat(input.name, input.mimeType);
  if (!format) {
    throw new Error(
      `Unsupported file type '${input.mimeType || 'unknown'}' for '${input.name}'. Supported formats are PDF, DOCX, PPTX, XLSX, CSV, and text files.`
    );
  }
  if (format === 'text') return textFromBuffer(input.bytes, input.maxCharacters);
  return extractOfficeTextInWorker(input);
}
