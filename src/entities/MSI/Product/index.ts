export type CategoryItem = {
  name: string;
  url: string | null;
};

export type SpecItem = {
  name: string;
  value: string | null;
};

export enum Availability {
  InStock = "in_stock",
  OutOfStock = "out_of_stock",
  PreOrder = "pre_order",
}

export type Product = {
  url: string;
  item_id: string | null;
  title: string;
  brand: string;
  product_category: string | null;
  category_tree: CategoryItem[];
  description: string | null;
  price: number | null;
  sale_price: number | null;
  availability: Availability | null;
  image_url: string | null;
  additional_image_urls: string[];
  specs: SpecItem[];
  star_rating: number | null;
  review_count: number | null;
  gtin: string | null;
  mpn: string | null;
  scraped_at: string;
};
