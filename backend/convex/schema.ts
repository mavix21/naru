import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { mentionValidator, personValidator, profileFields } from "./validators";

export default defineSchema({
  profiles: defineTable(profileFields)
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_username", ["username"]),
  socialLimits: defineTable({
    key: v.string(),
    window: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
  friendships: defineTable({
    low: v.id("profiles"),
    high: v.id("profiles"),
    initiator: v.id("profiles"),
    state: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("removed"),
    ),
    generation: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pair", ["low", "high"])
    .index("by_low", ["low"])
    .index("by_high", ["high"]),
  notifications: defineTable({
    clerkUserId: v.string(),
    eventKey: v.string(),
    kind: v.string(),
    actor: personValidator,
    read: v.boolean(),
    friendshipId: v.optional(v.id("friendships")),
    requestId: v.optional(v.id("paymentRequests")),
    splitId: v.optional(v.id("splits")),
    messageId: v.optional(v.string()),
  })
    .index("by_event", ["clerkUserId", "eventKey"])
    .index("by_owner", ["clerkUserId"])
    .index("by_unread", ["clerkUserId", "read"]),
  splits: defineTable({
    clerkUserId: v.string(),
    organizer: personValidator,
    messageId: v.string(),
    title: v.string(),
    total: v.string(),
    units: v.string(),
    asset: v.literal("XLM"),
    token: v.string(),
    participantIds: v.array(v.id("profiles")),
    includeSelf: v.boolean(),
    mode: v.union(v.literal("collect"), v.literal("reimburse")),
    shares: v.array(v.object({ person: personValidator, units: v.string() })),
    state: v.union(v.literal("draft"), v.literal("sent")),
    revision: v.number(),
    organizerAccount: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_turn", ["clerkUserId", "messageId"])
    .index("by_owner", ["clerkUserId"]),
  paymentRequests: defineTable({
    splitId: v.id("splits"),
    organizerId: v.id("profiles"),
    participantId: v.id("profiles"),
    amount: v.string(),
    units: v.string(),
    state: v.union(
      v.literal("outstanding"),
      v.literal("submitting"),
      v.literal("paid"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
    operationId: v.optional(v.id("operations")),
    hash: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_split", ["splitId"])
    .index("by_participant", ["participantId"]),
  replies: defineTable({
    clerkUserId: v.string(),
    messageId: v.string(),
    requestId: v.id("paymentRequests"),
    text: v.string(),
    state: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("cancelled"),
    ),
  }).index("by_turn", ["clerkUserId", "messageId"]),
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
    replySequence: v.optional(v.number()),
    error: v.union(v.string(), v.null()),
  }).index("by_clerk_user", ["clerkUserId"]),
  messages: defineTable({
    conversationId: v.id("conversations"),
    messageId: v.string(),
    sequence: v.number(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    mentions: v.optional(v.array(mentionValidator)),
    event: v.optional(
      v.object({
        kind: v.string(),
        actor: personValidator,
        replyId: v.optional(v.id("replies")),
        requestId: v.optional(v.id("paymentRequests")),
        splitId: v.optional(v.id("splits")),
        text: v.optional(v.string()),
      }),
    ),
  })
    .index("by_conversation", ["conversationId", "sequence"])
    .index("by_message", ["conversationId", "messageId"]),
  operations: defineTable({
    clerkUserId: v.string(),
    messageId: v.string(),
    recipientUserId: v.string(),
    recipientEmail: v.string(),
    recipientName: v.string(),
    recipientProfileId: v.optional(v.id("profiles")),
    recipientUsername: v.optional(v.string()),
    requestId: v.optional(v.id("paymentRequests")),
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
    .index("by_turn", ["clerkUserId", "messageId"])
    .index("by_hash", ["hash"]),
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
