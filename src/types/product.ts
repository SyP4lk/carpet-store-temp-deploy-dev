export interface RugProduct {
  product_name: {
    en: string;
    ru: string;
  };
  description: {
    en: string;
    ru: string;
  };
  features: {
    en: {
      head: string;
      care_and_warranty: string[];
      technical_info: string[];
    };
    ru: {
      head: string;
      care_and_warranty: string[];
      technical_info: string[];
    };
  };
  color: {
    en: string;
    ru: string;
    value: string;
  };
  collection: {
    en: string;
    ru: string;
    value: string;
  };
  style:{
    en: string;
    ru: string;
    value: string;
  }
  sizes: string[];
  defaultSize?: string;
  product_code: string;
  price: string;
  images: string[];
  id: number;
  isNew:boolean
  isRunners:boolean
  inStock:boolean
  sourceMeta?: {
    bmhome?: {
      priceOnRequest?: boolean;
      productUrl?: string;
    };
  };
}
