---
name: server-first-nextjs
description: Preserve narrow React client islands in this repo's Next.js apps. Use when writing or reviewing components, routes, providers, or Convex data access in apps/web or apps/admin.
---

# Server-First Next.js

Keep the React Server Component tree dominant in `apps/web` and `apps/admin`. Add client islands only where interactivity requires browser JavaScript.

## Boundary Rule

`"use client"` defines a client module boundary. That module and the modules it imports join the client dependency graph and ship to the browser. It does not convert Server Component output passed through `children` or another React-node prop; use that composition seam to form a donut around server-rendered content.

Start pages, layouts, and non-interactive components as Server Components. A component needs a client boundary only when it directly uses:

- state, effects, event handlers, or browser APIs
- client-only React context
- client hooks such as Convex `useQuery` or `useMutation`

Static presentation, async rendering, server data access, CSS responsiveness, links, and native forms do not require `"use client"`.

When interactivity appears high in a tree, extract the smallest interactive shell or leaf instead of converting the route. Pass serializable data into client leaves. Pass Server Component output through slots when the interactive shell must wrap it.

```tsx
// page.tsx: Server Component
export default function Page() {
  return (
    <InteractiveShell>
      <ServerContent />
    </InteractiveShell>
  );
}
```

```tsx
// interactive-shell.tsx
"use client";

export function InteractiveShell({ children }: { children: React.ReactNode }) {
  // Client state controls the shell; children retain their server boundary.
  return <section>{children}</section>;
}
```

## Convex Query Choice

Choose from the data's update semantics instead of making the whole consumer tree client-side.

| Need | Pattern |
| --- | --- |
| Live updates after the initial server render | `preloadQuery` in a Server Component, then `usePreloadedQuery` in the narrow client consumer |
| Fresh server snapshot without a subscription | `fetchQuery` in a Server Component |
| Shared data that changes infrequently | Cached server function with `"use cache"`, `fetchQuery`, `cacheLife`, and `cacheTag` |
| Mutation controls | Isolate `useMutation` in the smallest interactive leaf; keep surrounding display in Server Components |

For reactive data, preload at the highest server level that knows the arguments, but consume at the deepest client level that needs the subscription:

```tsx
// page.tsx
import { preloadQuery } from "convex/nextjs";

export default async function Page() {
  const preloadedTasks = await preloadQuery(api.tasks.list, {});
  return <Tasks preloadedTasks={preloadedTasks} />;
}
```

```tsx
// tasks.tsx
"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";

export function Tasks({
  preloadedTasks,
}: {
  preloadedTasks: Preloaded<typeof api.tasks.list>;
}) {
  const tasks = usePreloadedQuery(preloadedTasks);
  return <TaskList tasks={tasks} />;
}
```

For stable shared data, cache the server read and define its lifetime and invalidation policy:

```ts
import { fetchQuery } from "convex/nextjs";
import { cacheLife, cacheTag } from "next/cache";

export async function getCountries() {
  "use cache";
  cacheLife("days");
  cacheTag("countries");
  return fetchQuery(api.countries.list, {});
}
```

Use shared caching only when sharing the result across users is correct. Preserve the repo's established authentication-token flow for authenticated `preloadQuery` and `fetchQuery` calls. Consult Next.js documentation matching the installed version when choosing cache profiles or invalidation behavior.

## Completion Gate

Before finishing any change in either Next.js app:

1. Inspect every added or modified `"use client"` boundary and move it to the smallest module that directly needs client behavior.
2. Verify client modules do not import static sections that can remain Server Components; pass their rendered output through slots instead.
3. Classify each Convex read as reactive, fresh server-only, or cacheable shared data, then use the matching pattern above.
4. Verify props crossing into client components are serializable and cached results are safe to share.

The change is complete when each client boundary has a direct interactive reason and no surrounding server-renderable subtree was pulled into its client import graph for convenience.