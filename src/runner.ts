import { scrapeProduct } from '@scrapers/MSI/Product';
import { saveJsonToFile } from '@scrapers/MSI/Product/utils';

const OUTPUT_PATH = 'output/msi-product.json';

const main = async (): Promise<void> => {
  const product = await scrapeProduct();
  await saveJsonToFile(OUTPUT_PATH, product);
  console.log(`Product saved to ${OUTPUT_PATH}`);
};

main().catch((error: unknown) => {
  console.error(`Scraper failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
