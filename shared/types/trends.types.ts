/**
 * TRENDS API - Domain TypeScript Interfaces & DTOs
 * Conforms to the official OpenAPI 3.1.0 specification for TRENDS promotional products.
 * Regions supported: NZ, AU, SG.
 */

export type Region = "nz" | "au" | "sg";

export type ApiFormat = "json" | "xml";

export interface RegionalServerConfig {
  region: Region;
  url: string;
  currency: string;
  name: string;
}

export const REGION_CONFIGS: Record<Region, RegionalServerConfig> = {
  nz: { region: "nz", url: "https://nz.api.trends.nz", currency: "NZD", name: "New Zealand" },
  au: { region: "au", url: "https://au.api.trends.nz", currency: "AUD", name: "Australia" },
  sg: { region: "sg", url: "https://sg.api.trends.nz", currency: "SGD", name: "Singapore" },
};

/** All supported region codes — safe to import on the client. */
export const ALL_REGIONS: Region[] = ["nz", "au", "sg"];


// ==========================================
// 1. Lead Times Models
// ==========================================

export interface LeadTimeData {
  process: string;
  lead_time: string;
}

export interface LeadTimeListData {
  status: string;
  processes: LeadTimeData[];
}

// ==========================================
// 2. Categories Models
// ==========================================

export interface CategoryData {
  id: number;
  parent_id?: number | null;
  number?: string | null;
  name: string;
  mps_category?: string | null;
  xebra_code_1?: string | null;
  xebra_code_2?: string | null;
  sub_categories?: CategoryData[];
  appa_parent?: string | null;
  appa_child?: string | null;
}

export interface CategoryListData {
  status: string;
  country: string;
  data: CategoryData[];
}

export interface ListCategoriesQuery {
  inc_discontinued?: boolean;
}

// ==========================================
// 3. Product Sub-Models
// ==========================================

export interface ProductCategoryData {
  id: number;
  parent_id?: number | null;
  name: string;
  num?: string | null;
  appa_parent?: string | null;
  appa_child?: string | null;
}

export interface QuantityBreakData {
  quantity: number;
  price: number | string;
}

export interface AdditionalCostData {
  id?: number | string;
  type?: string;
  branding_option?: string;
  branding_area?: string;
  description?: string;
  unit_price?: number | string;
  setup?: boolean | string;
  setup_price?: number | string;
  price_per_unit_charge_codes?: string[];
  price_per_order_charge_code?: string;
}

export interface PricingData {
  type: string;
  primary_price_description?: string;
  less_than_moq?: boolean;
  prices: QuantityBreakData[];
  additional_costs?: AdditionalCostData[];
  pricing_comment?: string;
}

export interface ImageData {
  link: string;
  name?: string;
  stock_code?: string;
  colour?: string;
  caption?: string;
}

export interface CartonData {
  length?: number | string;
  width?: number | string;
  height?: number | string;
  weight?: number | string;
  quantity?: number;
}

export interface SpecificationData {
  specification: string;
  description: string;
}

export interface MaterialData {
  component: string;
  material: string;
}

export interface BrandingOptionData {
  print_type: string;
  print_description?: string;
}

export interface SizingData {
  sizing_line?: string;
  [key: string]: unknown;
}

// ==========================================
// 4. Products Models
// ==========================================

export interface ProductData {
  code: string;
  name: string;
  features?: string[];
  description?: string;
  additional_specifications?: SpecificationData[];
  additional_materials?: MaterialData[];
  active?: boolean;
  status?: string;
  last_updated?: string;
  images_updated?: string;
  categories?: ProductCategoryData[];
  colours?: string[];
  secondary_colours?: string[];
  colours_3?: string[];
  standard_colours?: string[];
  dimensions?: string;
  sizing?: SizingData[];
  branding_options?: BrandingOptionData[];
  packaging?: string;
  carton?: CartonData;
  full_colour?: boolean;
  mix_and_match?: boolean;
  image_count?: number;
  images?: ImageData[];
  product_wire?: string;
  product_wire_last_updated?: string;
  stock?: StockItemData[];
  pricing?: PricingData[];
}

export interface ProductListData {
  status: string;
  country: string;
  page_count: number;
  page_current: number;
  page_size: number;
  total_items: number;
  data: ProductData[];
}

export interface ProductShowData {
  status: string;
  country: string;
  data: ProductData | ProductData[];
}

export interface ListProductsQuery {
  page_size?: number;
  category_no?: number | string;
  page_no?: number;
  last_updated?: string;
  inc_discontinued?: boolean;
  inc_inactive?: boolean;
  [key: string]: unknown;
}

// ==========================================
// 5. Stock Models
// ==========================================

export interface StockItemData {
  stock_code: string;
  description: string;
  quantity: number;
  next_shipment?: number;
  due_date?: string | null;
}

export interface StockListData {
  status: string;
  country: string;
  data: StockItemData[];
}

// ==========================================
// 6. Orders Models
// ==========================================

export interface DeliveryAddressData {
  ship_to?: string;
  delivery_address_line_1: string;
  delivery_address_line_2?: string;
  delivery_address_line_3?: string;
  delivery_address_line_4?: string;
  delivery_address_line_5?: string;
  postal_code?: string;
}

export interface OrderLineData {
  code: string;
  description: string;
  quantity: number;
  price: number | string;
  gross: number | string;
}

export interface OrderTimestampsData {
  order_received?: string;
  last_proofed?: string;
  order_approved?: string;
  dispatch?: string;
  invoiced?: string;
}

export interface OrderData {
  order_number: string;
  purchase_order_number?: string;
  status: string;
  product?: string;
  job_description?: string;
  decoration_method?: string;
  quantity: number;
  value?: number | string;
  order_date?: string;
  ship_date?: string;
  delivery_address?: DeliveryAddressData;
  contact_email?: string;
  invoice?: string;
  invoice_number?: string;
  proof?: string;
  photo?: string;
  tracking?: string;
  order_lines?: OrderLineData[];
  time_stamps?: OrderTimestampsData;
}

export interface OrderListData {
  status: string;
  country: string;
  data: OrderData[];
}

export interface ListOrdersQuery {
  salesordernum?: string;
  ponum?: string;
}

export interface CreateOrderPayload {
  purchase_order_number: string;
  contact_email: string;
  delivery_address: DeliveryAddressData;
  order_lines: OrderLineData[];
  job_description?: string;
  decoration_method?: string;
}

// ==========================================
// 7. Proxy Envelope & Error Types
// ==========================================

export interface ApiProxyResponse<T> {
  success: boolean;
  region: Region;
  cached: boolean;
  cacheTtl?: number;
  timestamp: string;
  data: T;
  error?: string;
  isMockFallback?: boolean;
}

export interface ApiErrorDetail {
  message: string;
  status: number;
  code?: string;
  errors?: Record<string, string[]>;
}
