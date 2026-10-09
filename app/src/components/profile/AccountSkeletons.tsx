import { Skeleton } from "@/components/ui/skeleton";

export function WalletSkeleton() {
  return (
    <div>
      <output className="sr-only">Loading your wallet…</output>
      <div aria-hidden="true">
        <div className="flex h-6 items-center">
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="divide-y divide-border/50">
          {["xlm", "usdc"].map((asset) => (
            <div
              key={asset}
              className="flex h-14 items-center justify-between gap-4"
            >
              <div className="flex items-center gap-2.5">
                <div className="size-8 overflow-hidden rounded-full">
                  <Skeleton className="size-full" />
                </div>
                <Skeleton className="h-4 w-10" />
              </div>
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-1 border-t pt-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="size-8" />
          </div>
          <div className="mt-2 h-4" />
        </div>
      </div>
    </div>
  );
}

export function ProfileFormSkeleton() {
  return (
    <div>
      <output className="sr-only">Loading your profile…</output>
      <div aria-hidden="true" className="space-y-6">
        <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-muted/50 px-4 py-3">
          <Skeleton className="h-5 w-28 max-w-full" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="mt-2 h-11 w-full" />
        </div>
        <div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="mt-2 h-11 w-full" />
          <div className="mt-2 flex h-4 justify-end">
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
    </div>
  );
}
