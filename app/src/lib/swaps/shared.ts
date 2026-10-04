import { TESTNET_ASSETS } from "@naru/backend/money";
import { z } from "zod";

// Network-specific identities, never resolved by symbol or API token lists.
export const SWAP = {
  xlm: TESTNET_ASSETS.XLM,
  usdc: TESTNET_ASSETS.USDC,
  issuer: TESTNET_ASSETS.usdcIssuer,
  router: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
  factory: "CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY",
  routerHash:
    "4b95bbf9caec2c6e00c786f53c5f392c2fcdb8435ac0a862ab5e0645eb65824c",
  factoryHash:
    "86285a9234d3f0d687eaf88efe8d5d72172b38c9a86624c9934c0cbf2aff2993",
  pairHash: "8447525edd62f72ffaf52136358034657ea0511a8fec1cd0ebde649f86cca464",
  slippageBps: 50,
  lifetimeMs: 120_000,
} as const;

export const swapTermsSchema = z.object({
  assetOut: z.literal("USDC"),
  tokenOut: z.literal(SWAP.usdc),
  router: z.literal(SWAP.router),
  pool: z.string().regex(/^C[A-Z2-7]{55}$/),
  expectedOut: z.string().regex(/^[1-9]\d*$/),
  minimumOut: z.string().regex(/^[1-9]\d*$/),
  targetOut: z
    .string()
    .regex(/^[1-9]\d{0,38}$/)
    .optional(),
  quoteSource: z
    .enum(["soroswap_api", "soroswap_router"])
    .default("soroswap_api"),
  quoteLedger: z.number().int().positive().optional(),
  slippageBps: z.literal(SWAP.slippageBps),
  quotedAt: z.number().int(),
  expiresAt: z.number().int(),
  deadline: z.number().int(),
});

export type SwapTerms = z.infer<typeof swapTermsSchema>;

export type SwapIntent = {
  account: string;
  recipient: string;
  token: string;
  units: string;
  swap: SwapTerms;
};

export const swapReviewSchema = z.object({
  id: z.string(),
  auth: z.string(),
  expiration: z.number().int(),
  expiresAt: z.number().int(),
});

export type SwapReview = z.infer<typeof swapReviewSchema>;
