import { v } from "convex/values";

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
