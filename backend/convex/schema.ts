import { defineSchema, defineTable } from "convex/server";

import { profileFields } from "./validators";

export default defineSchema({
  profiles: defineTable(profileFields).index("by_clerk_user", ["clerkUserId"]),
});
