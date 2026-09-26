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
  conversations: defineTable({
    clerkUserId: v.string(),
    sequence: v.number(),
    activeTurn: v.union(v.string(), v.null()),
    activeUntil: v.number(),
    error: v.union(v.string(), v.null()),
  }).index("by_clerk_user", ["clerkUserId"]),
  messages: defineTable({
    conversationId: v.id("conversations"),
    messageId: v.string(),
    sequence: v.number(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  })
    .index("by_conversation", ["conversationId", "sequence"])
    .index("by_message", ["conversationId", "messageId"]),
  operations: defineTable({
    clerkUserId: v.string(),
    messageId: v.string(),
    recipientUserId: v.string(),
    recipientEmail: v.string(),
    recipientName: v.string(),
    account: v.string(),
    recipient: v.string(),
    asset: v.literal("XLM"),
    token: v.string(),
    amount: v.string(),
    units: v.string(),
    revision: v.number(),
    state: v.union(
      v.literal("awaiting_approval"),
      v.literal("submitting"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    reviewId: v.union(v.string(), v.null()),
    hash: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["clerkUserId"])
    .index("by_owner_state", ["clerkUserId", "state"])
    .index("by_turn", ["clerkUserId", "messageId"]),
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
