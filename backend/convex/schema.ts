import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { profileFields } from "./validators";

export default defineSchema({
  profiles: defineTable(profileFields).index("by_clerk_user", ["clerkUserId"]),
  companions: defineTable({
    clerkUserId: v.string(),
    name: v.string(),
    accent: v.union(
      v.literal("sky"),
      v.literal("coral"),
      v.literal("sunshine"),
    ),
    paymentChoiceMade: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_user", ["clerkUserId"]),
  payments: defineTable({
    clerkUserId: v.string(),
    device: v.string(),
    attempt: v.string(),
    started: v.boolean(),
    account: v.union(v.string(), v.null()),
    credentialId: v.union(v.string(), v.null()),
    publicKey: v.union(v.string(), v.null()),
    deployment: v.union(v.string(), v.null()),
    candidate: v.union(v.string(), v.null()),
    challenge: v.union(v.string(), v.null()),
    expires: v.union(v.number(), v.null()),
    state: v.union(
      v.literal("passkey"),
      v.literal("pending"),
      v.literal("ready"),
      v.literal("rejected"),
    ),
    balance: v.union(v.string(), v.null()),
    balanceError: v.union(v.string(), v.null()),
    job: v.union(
      v.object({
        state: v.string(),
        hash: v.union(v.string(), v.null()),
        error: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
    updatedAt: v.number(),
  }).index("by_clerk_user", ["clerkUserId"]),
});
