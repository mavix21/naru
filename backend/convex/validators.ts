import { v } from "convex/values";

export const sponsorJobKind = v.union(
  v.literal("deploy"),
  v.literal("fund"),
  v.literal("transfer"),
);

export const sponsorJobState = v.union(
  v.literal("review"),
  v.literal("preparing"),
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("failed"),
);

export const profileFields = {
  clerkUserId: v.string(),
  username: v.optional(v.string()),
  displayName: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  preferredGreeting: v.string(),
  onboardingStatus: v.union(v.literal("incomplete"), v.literal("complete")),
};

export const profileValidator = v.object({
  _id: v.id("profiles"),
  _creationTime: v.number(),
  ...profileFields,
});

export const personValidator = v.object({
  userId: v.id("profiles"),
  username: v.string(),
  displayName: v.string(),
  companionName: v.string(),
  accent: v.union(v.literal("sky"), v.literal("coral"), v.literal("sunshine")),
});

export const mentionValidator = v.object({
  userId: v.id("profiles"),
  start: v.number(),
  end: v.number(),
  label: v.string(),
});
