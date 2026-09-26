import { v } from "convex/values";

export const profileFields = {
  clerkUserId: v.string(),
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
