import { describe, expect, it } from 'vitest';
import { extractDriveItemText } from '../src/lib/drive-item-extractor.js';

describe('extractDriveItemText', () => {
  it('bounds text-file output before it is returned to the caller', async () => {
    const result = await extractDriveItemText({
      bytes: Buffer.from('abcdefghij'),
      name: 'clauses.txt',
      mimeType: 'text/plain',
      maxCharacters: 4,
    });

    expect(result).toEqual({ text: 'abcd', truncated: true });
  });

  it('rejects unsupported file types before starting a parser worker', async () => {
    await expect(
      extractDriveItemText({
        bytes: Buffer.from('not an archive'),
        name: 'archive.zip',
        mimeType: 'application/zip',
        maxCharacters: 1000,
      })
    ).rejects.toThrow('Unsupported file type');
  });

  it('runs supported binary formats in the parser worker', async () => {
    await expect(
      extractDriveItemText({
        bytes: Buffer.from('%PDF-1.4\ninvalid'),
        name: 'invalid.pdf',
        mimeType: 'application/pdf',
        maxCharacters: 1000,
      })
    ).rejects.toThrow('Invalid PDF structure');
  });
});
