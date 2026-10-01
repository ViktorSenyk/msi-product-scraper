import { chromium } from 'playwright';
import {
  findProductData,
  getCleanText,
  getNumber,
  getPriceFromText,
  isObject,
} from '@scrapers/MSI/Product/utils';
import { Availability } from '@entities/MSI/Product';
import type { CategoryItem, Product, SpecItem } from '@entities/MSI/Product';
import type { Locator, Page } from 'playwright';

type StructuredProductData = Record<string, unknown>;

const TARGET_URL =
  'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';

const PRODUCT_TITLE_SELECTOR = 'h2.crop-text-2.title';
const AVAILABILITY_BY_TEXT = new Map<string, Availability>([
  ['in stock', Availability.InStock],
  ['out of stock', Availability.OutOfStock],
  ['pre-order', Availability.PreOrder],
  ['notify me', Availability.OutOfStock],
]);

const getElementText = async (locator: Locator): Promise<string | null> => {
  if ((await locator.count()) === 0) {
    return null;
  }

  return getCleanText(await locator.textContent());
};

const getAvailability = async (page: Page): Promise<Availability | null> => {
  const elementTexts = await page.locator('body *').allTextContents();
  const statuses = elementTexts.map(value => {
    const text = getCleanText(value)?.toLowerCase() ?? '';

    return AVAILABILITY_BY_TEXT.get(text);
  });

  return statuses.find(status => status !== undefined) ?? null;
};

const getStructuredProductData = async (page: Page): Promise<StructuredProductData | null> => {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();

  const products = scripts.map(script => {
    try {
      return findProductData(JSON.parse(script));
    } catch {
      // Skip scripts containing invalid JSON
      return null;
    }
  });

  return products.find(product => product !== null) ?? null;
};

const getCategoryTree = async (page: Page, productTitle: string): Promise<CategoryItem[]> => {
  const breadcrumbs = await page.locator('.breadcrumb li').evaluateAll(items =>
    items.map(item => {
      const link = item.querySelector('a');

      return {
        text: item.textContent,
        url: link instanceof HTMLAnchorElement ? link.href : null,
      };
    }),
  );
  const currentTitle = productTitle.toLowerCase();

  return breadcrumbs.flatMap(({ text, url }) => {
    const name = getCleanText(text);

    if (!name) {
      return [];
    }

    const normalizedName = name.toLowerCase();

    if (normalizedName === 'home' || normalizedName === currentTitle) {
      return [];
    }

    return [{ name, url }];
  });
};

const getProductImages = async (page: Page, productTitle: string): Promise<string[]> => {
  const images = await page.locator('img').evaluateAll(elements =>
    elements.flatMap(element => {
      if (!(element instanceof HTMLImageElement)) {
        return [];
      }

      return [{ alt: element.alt, url: element.currentSrc || element.src }];
    }),
  );
  const title = productTitle.toLowerCase();
  const imageUrls = images
    .filter(image => image.alt.toLowerCase().includes(title))
    .map(image => image.url)
    .filter(Boolean);

  return [...new Set(imageUrls)];
};

const getSpecs = async (page: Page): Promise<SpecItem[]> => {
  const rows = await page
    .locator('tr')
    .evaluateAll(elements =>
      elements.map(row => Array.from(row.querySelectorAll('th, td'), cell => cell.textContent)),
    );

  return rows.flatMap(cells => {
    const [name, ...values] = cells.map(getCleanText);

    if (!name || values.length === 0) {
      return [];
    }

    return [{ name, value: values.filter(Boolean).join(' ') || null }];
  });
};

const getBrand = (productData: StructuredProductData | null): string | null => {
  const brand = productData?.brand;

  if (isObject(brand)) {
    return getCleanText(brand.name);
  }

  return getCleanText(brand);
};

const getRating = async (
  page: Page,
  productData: StructuredProductData | null,
) => {
  const text = await getElementText(page.locator('#average-rating-info').first());
  const [ratingText, reviewCountText] = text?.split('(') ?? [];
  const structuredRating = productData?.aggregateRating;
  const fallback = isObject(structuredRating) ? structuredRating : {};

  return {
    star_rating: getNumber(ratingText) ?? getNumber(fallback.ratingValue),
    review_count:
      getNumber(reviewCountText?.replace(')', '')) ?? getNumber(fallback.reviewCount),
  };
};

export const buildProduct = async (page: Page): Promise<Product> => {
  const productTitle = page.locator(PRODUCT_TITLE_SELECTOR).first();
  const title = await getElementText(productTitle);

  if (!title) {
    throw new Error('Product title is missing.');
  }

  const description = await getElementText(productTitle.locator('xpath=following::p[1]'));
  const priceText = await getElementText(
    page.locator('[class*="price" i]').filter({ visible: true }).first(),
  );
  const availability = await getAvailability(page);

  const categoryTree = await getCategoryTree(page, title);
  const imageUrls = await getProductImages(page, title);
  const specs = await getSpecs(page);
  const productData = await getStructuredProductData(page);
  const rating = await getRating(page, productData);
  const manufacturerNumber = specs.find(({ name }) => {
    const label = name.toLowerCase();

    return label.includes('manufacturer number') || label.includes('mpn');
  })?.value;

  return {
    url: page.url(),
    item_id: getCleanText(productData?.sku) ?? getCleanText(productData?.productID),
    title,
    brand: getBrand(productData) ?? 'MSI',
    product_category: categoryTree.map(({ name }) => name).join(' > ') || null,
    category_tree: categoryTree,
    description,
    price: getPriceFromText(priceText),
    sale_price: null,
    availability,
    image_url: imageUrls[0] ?? null,
    additional_image_urls: imageUrls.slice(1),
    specs,
    star_rating: rating.star_rating,
    review_count: rating.review_count,
    gtin:
      getCleanText(productData?.gtin) ??
      getCleanText(productData?.gtin13) ??
      getCleanText(productData?.gtin12),
    mpn: getCleanText(productData?.mpn) ?? manufacturerNumber ?? null,
    scraped_at: new Date().toISOString(),
  };
};

export const scrapeProduct = async (): Promise<Product> => {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
  });

  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        `(KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
      locale: 'en-US',
    });

    const response = await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    if (!response?.ok()) {
      throw new Error(`MSI returned HTTP ${response?.status() ?? 'unknown'}.`);
    }

    await page.locator(PRODUCT_TITLE_SELECTOR).first().waitFor({
      state: 'visible',
      timeout: 30_000,
    });

    return await buildProduct(page);
  } finally {
    await browser.close();
  }
};
