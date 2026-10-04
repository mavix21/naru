export function WalletBalances({
  xlm,
  usdc,
  xlmError,
  usdcError,
}: {
  xlm: string | null;
  usdc: string | null;
  xlmError?: string | null;
  usdcError?: string | null;
}) {
  return (
    <dl className="divide-y divide-border/50">
      {[
        { asset: "XLM", amount: xlm, error: xlmError },
        { asset: "USDC", amount: usdc, error: usdcError },
      ].map(({ asset, amount, error }) => (
        <div
          key={asset}
          className="flex items-center justify-between gap-4 py-3"
        >
          <dt className="flex shrink-0 items-center gap-2.5 font-medium">
            <span
              aria-hidden="true"
              className={`flex size-8 items-center justify-center rounded-full ${asset === "XLM" ? "bg-foreground text-background" : "bg-[#2775ca] text-white"}`}
            >
              {asset === "XLM" ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-4"
                  focusable="false"
                >
                  <path d="M12.003 1.716c-1.37 0-2.7.27-3.948.78A10.18 10.18 0 0 0 2.66 7.901a10.136 10.136 0 0 0-.797 3.954c0 .258.01.516.027.775a1.942 1.942 0 0 1-1.055 1.88L0 14.934v1.902l2.463-1.26.072-.032v.005l.77-.39.758-.385.066-.039 14.807-7.56 1.666-.847 3.392-1.732V2.694L17.792 5.86 3.744 13.025l-.104.055-.017-.115a8.286 8.286 0 0 1-.071-1.105c0-2.255.88-4.377 2.474-5.977a8.462 8.462 0 0 1 2.71-1.82 8.513 8.513 0 0 1 3.2-.654h.067a8.41 8.41 0 0 1 4.09 1.055l1.628-.83.126-.066a10.11 10.11 0 0 0-5.845-1.853zM24 7.143 5.047 16.808l-1.666.847L0 19.382v1.902l3.282-1.671 2.91-1.485 14.058-7.153.105-.055.016.115c.05.369.072.743.072 1.11 0 2.255-.88 4.383-2.475 5.978a8.461 8.461 0 0 1-2.71 1.82 8.305 8.305 0 0 1-3.2.654h-.06c-1.441 0-2.86-.369-4.102-1.061l-.066.033-1.683.857c.594.418 1.232.776 1.903 1.062a10.11 10.11 0 0 0 3.947.797 10.09 10.09 0 0 0 7.17-2.975 10.136 10.136 0 0 0 2.969-7.18c0-.259-.005-.523-.027-.781a1.942 1.942 0 0 1 1.055-1.88L24 9.044z" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="size-5"
                  focusable="false"
                >
                  <path
                    d="M8 3.5a9.5 9.5 0 0 0 0 17M16 3.5a9.5 9.5 0 0 1 0 17M15 8.5c0-1.5-6-2-6 .5s6 2 6 5-6 2.5-6 .5M12 5v2M12 17v2"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </span>
            {asset}
          </dt>
          <dd
            className="min-w-0 text-right text-base font-medium break-all tabular-nums"
            title={error ?? undefined}
          >
            {amount ?? (
              <span aria-label={`${asset} balance unavailable`}>—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
