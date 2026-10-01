import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const getCleanText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.replace(/\s+/g, ' ').trim();

  return text || null;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};

export const findProductData = (data: unknown): Record<string, unknown> | null => {
  if (Array.isArray(data)) {
    const products = data.map(findProductData);

    return products.find(product => product !== null) ?? null;
  }

  if (!isObject(data)) {
    return null;
  }

  const type = data['@type'];

  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
    return data;
  }

  // Some pages group their structured data inside an `@graph` array
  return findProductData(data['@graph']);
};

export const getPriceFromText = (value: string | null | undefined): number | null => {
  const text = getCleanText(value);

  if (!text) {
    return null;
  }

  const amount = text.replaceAll('$', '').replaceAll(',', '').trim();

  return getNumber(amount);
};

export const saveJsonToFile = async (filePath: string, data: unknown): Promise<void> => {
  const fullPath = path.resolve(filePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};
