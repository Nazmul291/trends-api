import type {
  CategoryListData,
  ProductListData,
  ProductShowData,
  StockListData,
  LeadTimeListData,
  OrderListData,
  Region,
} from "../../shared/types/trends.types";

/**
 * Realistic Mock Datasets conforming strictly to OpenAPI 3.1.0 specifications.
 * Used when regional API credentials are not yet supplied in the local .env.
 */

export const MOCK_CATEGORIES: CategoryListData = {
  status: "success",
  country: "NZ",
  data: [
    { id: 101, number: "101", name: "Drinkware & Bottles", mps_category: "DRINK" },
    { id: 102, number: "102", name: "Pens & Writing Instruments", mps_category: "PENS" },
    { id: 103, number: "103", name: "Bags & Totes", mps_category: "BAGS" },
    { id: 104, number: "104", name: "Apparel & Headwear", mps_category: "APPAREL" },
    { id: 105, number: "105", name: "Technology & Audio", mps_category: "TECH" },
    { id: 106, number: "106", name: "Notebooks & Stationery", mps_category: "OFFICE" },
    { id: 107, number: "107", name: "Eco-Friendly & Bamboo", mps_category: "ECO" },
    { id: 108, number: "108", name: "Confectionery & Food Gifts", mps_category: "FOOD" },
  ],
};

export const MOCK_LEAD_TIMES: LeadTimeListData = {
  status: "success",
  processes: [
    { process: "Laser Engraving", lead_time: "3-5 business days" },
    { process: "Pad Printing (1-2 Colours)", lead_time: "5-7 business days" },
    { process: "Digital Direct (Full Colour)", lead_time: "3-5 business days" },
    { process: "Screen Printing", lead_time: "7-10 business days" },
    { process: "Embroidery", lead_time: "5-8 business days" },
    { process: "Sublimation Printing", lead_time: "4-6 business days" },
  ],
};

export function getMockProducts(region: Region): ProductListData {
  const isNZ = region === "nz";
  const currencyMultiplier = isNZ ? 1.0 : region === "au" ? 0.95 : 0.85;

  return {
    status: "success",
    country: region.toUpperCase(),
    page_count: 1,
    page_current: 1,
    page_size: 50,
    total_items: 6,
    data: [
      {
        code: "10042",
        name: "Alpine Vacuum Insulated Bottle 750ml",
        description:
          "Double-wall vacuum insulated stainless steel water bottle. Keeps drinks cold for up to 24 hours or hot for up to 12 hours. Features a leak-proof bamboo top lid.",
        features: ["Double wall vacuum insulation", "Food grade 18/8 stainless steel", "BPA Free"],
        dimensions: "Dia 75mm x H 265mm",
        colours: ["Matte Black", "Brushed Silver", "Navy Blue", "Olive Green", "White"],
        branding_options: [
          { print_type: "Laser Engraving", print_description: "35mm x 90mm" },
          { print_type: "Pad Print", print_description: "40mm x 55mm" },
          { print_type: "Digital Direct", print_description: "Full wrap 220mm x 160mm" },
        ],
        images: [
          { link: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&auto=format&fit=crop&q=80", colour: "Matte Black" },
          { link: "https://images.unsplash.com/photo-1544816155-12df9643f363?w=600&auto=format&fit=crop&q=80", colour: "White" },
        ],
        pricing: [
          {
            type: "indent",
            primary_price_description: "Tiered Volume Pricing",
            prices: [
              { quantity: 25, price: (16.5 * currencyMultiplier).toFixed(2) },
              { quantity: 50, price: (14.8 * currencyMultiplier).toFixed(2) },
              { quantity: 100, price: (13.2 * currencyMultiplier).toFixed(2) },
              { quantity: 250, price: (11.9 * currencyMultiplier).toFixed(2) },
              { quantity: 500, price: (10.5 * currencyMultiplier).toFixed(2) },
            ],
          },
        ],
        stock: [
          { stock_code: "10042-BLK", description: "Matte Black - 750ml", quantity: 1850 },
          { stock_code: "10042-SLV", description: "Brushed Silver - 750ml", quantity: 920 },
          { stock_code: "10042-NVY", description: "Navy Blue - 750ml", quantity: 45, next_shipment: 500, due_date: "2026-11-15" },
        ],
      },
      {
        code: "10284",
        name: "Contour Soft-Touch Metal Ballpoint Pen",
        description:
          "Premium aluminum click ballpoint pen with a matte rubberized soft-touch barrel, polished chrome accents, and German-manufactured black Dokumental ink refill.",
        features: ["German Dokumental ink", "Soft-touch tactile finish", "1,800m writing distance"],
        dimensions: "Dia 10mm x L 138mm",
        colours: ["Gunmetal", "Matte Navy", "Burgundy", "Forest Green", "Rose Gold"],
        branding_options: [
          { print_type: "Mirror Finish Laser Engraving", print_description: "50mm x 7mm" },
          { print_type: "Pad Print", print_description: "45mm x 7mm" },
        ],
        images: [
          { link: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=600&auto=format&fit=crop&q=80", colour: "Gunmetal" },
        ],
        pricing: [
          {
            type: "indent",
            primary_price_description: "Tiered Volume Pricing",
            prices: [
              { quantity: 100, price: (2.4 * currencyMultiplier).toFixed(2) },
              { quantity: 250, price: (1.95 * currencyMultiplier).toFixed(2) },
              { quantity: 500, price: (1.65 * currencyMultiplier).toFixed(2) },
              { quantity: 1000, price: (1.35 * currencyMultiplier).toFixed(2) },
            ],
          },
        ],
        stock: [
          { stock_code: "10284-GUN", description: "Gunmetal Barrel", quantity: 8400 },
          { stock_code: "10284-NVY", description: "Navy Barrel", quantity: 6200 },
          { stock_code: "10284-RGD", description: "Rose Gold Barrel", quantity: 1200 },
        ],
      },
      {
        code: "10567",
        name: "Eco Canvas Shopper Tote Bag 320gsm",
        description:
          "Heavyweight 100% unbleached natural cotton canvas tote bag with reinforced cross-stitched handles and a generous 10cm base gusset.",
        features: ["100% natural cotton canvas", "320gsm heavyweight fabric", "Reinforced shoulder straps"],
        dimensions: "W 380mm x H 420mm x Gusset 100mm",
        colours: ["Natural", "Black", "Charcoal", "Sage Green"],
        branding_options: [
          { print_type: "Screen Print", print_description: "250mm x 280mm" },
          { print_type: "Full Colour Digital Transfer", print_description: "210mm x 297mm (A4)" },
        ],
        images: [
          { link: "https://images.unsplash.com/photo-1544816155-12df9643f363?w=600&auto=format&fit=crop&q=80", colour: "Natural" },
        ],
        pricing: [
          {
            type: "indent",
            primary_price_description: "Tiered Volume Pricing",
            prices: [
              { quantity: 50, price: (6.9 * currencyMultiplier).toFixed(2) },
              { quantity: 100, price: (5.6 * currencyMultiplier).toFixed(2) },
              { quantity: 250, price: (4.8 * currencyMultiplier).toFixed(2) },
              { quantity: 500, price: (4.15 * currencyMultiplier).toFixed(2) },
            ],
          },
        ],
        stock: [
          { stock_code: "10567-NAT", description: "Natural Unbleached", quantity: 4500 },
          { stock_code: "10567-BLK", description: "Jet Black", quantity: 2800 },
        ],
      },
      {
        code: "11580",
        name: "Bamboo 15W Fast Wireless Charging Stand",
        description:
          "Eco-friendly desktop wireless charging phone stand crafted from sustainably sourced natural bamboo. Supports dual-coil 15W fast charging for vertical or horizontal viewing.",
        features: ["Natural organic bamboo casing", "15W Fast Qi wireless standard", "Over-temperature protection"],
        dimensions: "W 72mm x H 115mm x D 86mm",
        colours: ["Natural Bamboo"],
        branding_options: [
          { print_type: "Laser Engraving", print_description: "55mm x 55mm" },
          { print_type: "Pad Print", print_description: "50mm x 40mm" },
        ],
        images: [
          { link: "https://images.unsplash.com/photo-1586105251261-72a756497a11?w=600&auto=format&fit=crop&q=80", colour: "Natural Bamboo" },
        ],
        pricing: [
          {
            type: "indent",
            primary_price_description: "Tiered Volume Pricing",
            prices: [
              { quantity: 25, price: (24.0 * currencyMultiplier).toFixed(2) },
              { quantity: 50, price: (21.5 * currencyMultiplier).toFixed(2) },
              { quantity: 100, price: (18.9 * currencyMultiplier).toFixed(2) },
              { quantity: 250, price: (16.8 * currencyMultiplier).toFixed(2) },
            ],
          },
        ],
        stock: [
          { stock_code: "11580-BAM", description: "Natural Bamboo Stand", quantity: 680 },
        ],
      },
      {
        code: "12040",
        name: "Classic A5 Hardcover Notebook with Bookmark",
        description:
          "Sophisticated A5 size journal with thermo-PU leather-look cover, 160 lined pages (80 leaves) of 80gsm cream wood-free paper, elastic closure band, ribbon bookmark, and back document pocket.",
        features: ["Thermo-PU debossable cover", "80gsm cream lined paper", "Expandable inner back pocket"],
        dimensions: "W 145mm x L 210mm x D 15mm",
        colours: ["Black", "Cognac Brown", "Slate Grey", "Navy", "Teal"],
        branding_options: [
          { print_type: "Debossing / Hot Stamp", print_description: "70mm x 70mm" },
          { print_type: "Digital Direct (Full Colour)", print_description: "120mm x 180mm" },
        ],
        images: [
          { link: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80", colour: "Black" },
        ],
        pricing: [
          {
            type: "indent",
            primary_price_description: "Tiered Volume Pricing",
            prices: [
              { quantity: 50, price: (8.2 * currencyMultiplier).toFixed(2) },
              { quantity: 100, price: (7.1 * currencyMultiplier).toFixed(2) },
              { quantity: 250, price: (6.2 * currencyMultiplier).toFixed(2) },
              { quantity: 500, price: (5.45 * currencyMultiplier).toFixed(2) },
            ],
          },
        ],
        stock: [
          { stock_code: "12040-BLK", description: "Black A5 Journal", quantity: 3200 },
          { stock_code: "12040-BRN", description: "Cognac Brown A5 Journal", quantity: 1650 },
        ],
      },
    ],
  };
}

export function getMockSingleProduct(productId: string | number, region: Region): ProductShowData {
  const products = getMockProducts(region).data;
  const match = products.find((p) => p.code === String(productId)) || products[0];
  return {
    status: "success",
    country: region.toUpperCase(),
    data: match,
  };
}

export function getMockStock(productId: string | number, region: Region): StockListData {
  const prod = getMockSingleProduct(productId, region).data;
  const singleProd = Array.isArray(prod) ? prod[0] : prod;
  return {
    status: "success",
    country: region.toUpperCase(),
    data: singleProd?.stock || [],
  };
}

export function getMockOrders(region: Region): OrderListData {
  const currencyMultiplier = region === "au" ? 0.95 : region === "sg" ? 0.8 : 1.0;
  return {
    status: "success",
    country: region.toUpperCase(),
    data: [
      {
        order_number: "SO-99214",
        purchase_order_number: "PO-88124",
        status: "Dispatched",
        job_description: "Corporate Onboarding Merchandise Packs",
        product: "Alpine Vacuum Bottle 750ml",
        quantity: 250,
        value: 3850.0 * currencyMultiplier,
        order_date: "2026-09-18",
        ship_date: "2026-09-24",
        contact_email: "orders@acmepacific.com",
        delivery_address: {
          ship_to: "Acme Pacific Headquarters",
          delivery_address_line_1: "Level 4, 120 Quay Street",
          postal_code: "1010",
        },
        tracking: "https://www.nzpost.co.nz/tools/tracking?track=TRND8812409NZ",
        invoice: "https://api.trends.nz/invoices/INV-SO-99214.pdf",
        invoice_number: "INV-99214",
        proof: "https://api.trends.nz/proofs/PRF-SO-99214-v2.pdf",
        photo: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80",
        order_lines: [
          { code: "10042-BLK", description: "Alpine Vacuum Bottle 750ml", quantity: 250, price: 11.9 * currencyMultiplier, gross: 2975.0 * currencyMultiplier },
          { code: "10284-GUN", description: "Contour Soft-Touch Pen", quantity: 250, price: 3.5 * currencyMultiplier, gross: 875.0 * currencyMultiplier },
        ],
        time_stamps: {
          order_received: "2026-09-18T09:20:00Z",
          last_proofed: "2026-09-19T10:15:00Z",
          order_approved: "2026-09-19T14:10:00Z",
          dispatch: "2026-09-24T16:45:00Z",
          invoiced: "2026-09-25T08:00:00Z",
        },
      },
      {
        order_number: "SO-99182",
        purchase_order_number: "PO-87995",
        status: "In Production",
        job_description: "Annual Tech Conference Giveaways",
        product: "Classic A5 Notebook",
        quantity: 500,
        value: 2725.0 * currencyMultiplier,
        order_date: "2026-09-25",
        contact_email: "events@techcon2026.org",
        delivery_address: {
          ship_to: "Convention Centre Event Logistics",
          delivery_address_line_1: "50 Hobson Street",
          postal_code: "1010",
        },
        proof: "https://api.trends.nz/proofs/PRF-SO-99182-final.pdf",
        order_lines: [
          { code: "12040-BLK", description: "Classic A5 Notebook", quantity: 500, price: 5.45 * currencyMultiplier, gross: 2725.0 * currencyMultiplier },
        ],
        time_stamps: {
          order_received: "2026-09-25T11:00:00Z",
          last_proofed: "2026-09-25T15:30:00Z",
          order_approved: "2026-09-26T08:30:00Z",
        },
      },
      {
        order_number: "SO-99050",
        purchase_order_number: "PO-87610",
        status: "Invoiced",
        job_description: "Executive Gifts & Tumblers",
        product: "Verona Double-Wall Tumbler",
        quantity: 120,
        value: 1980.0 * currencyMultiplier,
        order_date: "2026-09-10",
        ship_date: "2026-09-16",
        contact_email: "procurement@apexholdings.com",
        delivery_address: {
          ship_to: "Apex Holdings Tower",
          delivery_address_line_1: "88 Shortland Street",
          postal_code: "1010",
        },
        tracking: "https://www.nzpost.co.nz/tools/tracking?track=TRND8761011NZ",
        invoice: "https://api.trends.nz/invoices/INV-SO-99050.pdf",
        invoice_number: "INV-99050",
        proof: "https://api.trends.nz/proofs/PRF-SO-99050.pdf",
        order_lines: [
          { code: "10055-SLV", description: "Verona Tumbler 500ml", quantity: 120, price: 16.5 * currencyMultiplier, gross: 1980.0 * currencyMultiplier },
        ],
        time_stamps: {
          order_received: "2026-09-10T08:00:00Z",
          order_approved: "2026-09-11T09:00:00Z",
          dispatch: "2026-09-16T17:00:00Z",
          invoiced: "2026-09-17T09:30:00Z",
        },
      },
    ],
  };
}
