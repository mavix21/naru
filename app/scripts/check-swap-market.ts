import { displayAmount } from "../src/lib/money";
import { serverConfig } from "../src/lib/smart-account/server/config";
import { requestSwapQuote, verifySwapMarket } from "../src/lib/swaps/market";
import { SWAP } from "../src/lib/swaps/shared";

// Read-only diagnostic: never signs, funds, creates accounts, or submits swaps.
const { publicConfig } = serverConfig();
console.log({
  checkedAt: new Date().toISOString(),
  network: "Stellar Testnet",
  xlm: SWAP.xlm,
  usdc: SWAP.usdc,
  issuer: SWAP.issuer,
});
try {
  const market = await verifySwapMarket(publicConfig.sponsor);
  console.log({
    pool: market.pool,
    usdcLiquidity: displayAmount(market.reserveOut.toString()),
    contractsVerified: true,
  });
  const quote = await requestSwapQuote("10000000", publicConfig.sponsor);
  console.log({
    input: "1 XLM",
    estimatedUSDC: displayAmount(quote.expectedOut),
    minimumUSDC: displayAmount(quote.minimumOut),
    quoteSource: quote.quoteSource,
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Testnet swap check failed.",
  );
  process.exitCode = 1;
}
