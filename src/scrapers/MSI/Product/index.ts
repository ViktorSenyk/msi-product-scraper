import { chromium, errors } from 'playwright';
import {
  getCleanText,
  getNumber,
  getPriceFromText,
} from '@scrapers/MSI/Product/utils';
import { Availability } from '@entities/MSI/Product';
import type { CategoryItem, Product, SpecItem } from '@entities/MSI/Product';
import type { Locator, Page } from 'playwright';

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
  const elementTexts = await page.locator('#prices-new ~ span').allTextContents();
  const statuses = elementTexts.map(value => {
    const text = getCleanText(value)?.toLowerCase() ?? '';

    return AVAILABILITY_BY_TEXT.get(text);
  });

  return statuses.find(status => status !== undefined) ?? null;
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

const getProductImages = async (page: Page): Promise<string[]> => {
  const imageUrls = await page.locator('#imagePopup, .product-detail-thumb-bto').evaluateAll(images =>
    images.map(image => image.getAttribute('src') ?? '').filter(Boolean),
  );

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

const getRating = async (page: Page) => {
  try {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('#average-rating-info')).some(element => {
        const text = element.textContent ?? '';
        return text.includes('(') && text.includes(')');
      }),
      null,
      { timeout: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) {
      throw error;
    }
  }

  const texts = await page.locator('#average-rating-info').allTextContents();
  const text = texts.find(value => value.includes('(') && value.includes(')'));
  const [ratingText, reviewCountText] = text?.split('(') ?? [];

  return {
    star_rating: getNumber(ratingText),
    review_count: getNumber(reviewCountText?.replace(')', '')),
  };
};

export const buildProduct = async (page: Page): Promise<Product> => {
  const productTitle = page.locator(PRODUCT_TITLE_SELECTOR).first();
  const title = await getElementText(productTitle);

  if (!title) {
    throw new Error('Product title is missing.');
  }

  const description = await getElementText(productTitle.locator('xpath=following::p[1]'));
  const priceText = await getElementText(page.locator('#prices-new'));
  const availability = await getAvailability(page);

  const categoryTree = await getCategoryTree(page, title);
  const imageUrls = await getProductImages(page);
  const specs = await getSpecs(page);
  const productId = await page.locator('input[name="product_id"]').evaluateAll(inputs =>
    inputs[0]?.getAttribute('value') ?? null,
  );
  const rating = await getRating(page);
  const manufacturerNumber = specs.find(({ name }) => {
    const label = name.toLowerCase();

    return label.includes('manufacturer number') || label.includes('mpn');
  })?.value;

  return {
    url: page.url(),
    item_id: getCleanText(productId),
    title,
    brand: 'MSI',
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
    gtin: null,
    mpn: manufacturerNumber ?? null,
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
