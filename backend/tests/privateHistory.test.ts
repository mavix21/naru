/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{js,ts}");
const key = "private-history-migration-server-key";

async function setup() {
  process.env.NARU_PAYMENTS_KEY = key;
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const user = t.withIdentity({ subject: "history-owner" });
  const records = await t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("conversations", {
      clerkUserId: "history-owner",
      sequence: 2,
      activeTurn: null,
      activeUntil: 0,
      error: null,
    });
    const messages = [
      {
        id: "old-user",
        role: "user" as const,
        parts: [{ type: "text", text: "What is my balance?" }],
      },
      {
        id: "old-assistant",
        role: "assistant" as const,
        parts: [
          { type: "step-start" },
          {
            type: "tool-readBalance",
            toolCallId: "balance-tool",
            state: "output-available",
            input: {},
            output: { active: false },
          },
          { type: "text", text: "Your payments are not activated yet." },
        ],
      },
    ];
    const ids = [];
    for (const [index, message] of messages.entries()) {
      ids.push(
        await ctx.db.insert("messages", {
          conversationId,
          messageId: message.id,
          role: message.role,
          sequence: index + 1,
          content: JSON.stringify(message),
          agentMessageIds: [],
        }),
      );
    }
    return { conversationId, ids };
  });
  return { t, user, ...records };
}

describe("production private history migration", () => {
  it("preserves identity, ordering, text and saved tool output and is safe to rerun", async () => {
    const { t, user, conversationId } = await setup();
    const before = await user.query(api.conversations.current, {});
    const migrated = await t.mutation(internal.migrations.privateHistory, {
      cursor: null,
    });
    expect(migrated.messages).toBe(2);
    const after = await user.query(api.conversations.current, {});
    expect(
      after.messages.map((row) => [
        row._id,
        row._creationTime,
        row.sequence,
        row.messageId,
        row.role,
      ]),
    ).toEqual(
      before.messages.map((row) => [
        row._id,
        row._creationTime,
        row.sequence,
        row.messageId,
        row.role,
      ]),
    );
    expect(after.messages[0].message.parts).toMatchObject([
      { type: "text", text: "What is my balance?" },
    ]);
    expect(after.messages[1].message.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-readBalance",
          state: "output-available",
          output: { active: false },
          toolCallId: "balance-tool",
        }),
        expect.objectContaining({
          type: "text",
          text: "Your payments are not activated yet.",
        }),
      ]),
    );
    // The old web release and the new release receive the same reconstructed content.
    expect(JSON.parse(after.messages[1].content)).toEqual(
      after.messages[1].message,
    );
    const stored = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(
      stored.every(
        (row) => row.content === undefined && row.agentMessageIds!.length > 0,
      ),
    ).toBe(true);
    const again = await t.mutation(internal.migrations.privateHistory, {
      cursor: null,
    });
    expect(again.messages).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual(
      stored,
    );
    expect(
      (await t.run((ctx) => ctx.db.get(conversationId)))?.agentThreadId,
    ).toBe(after.conversation?.agentThreadId);
    expect(
      (
        await t
          .withIdentity({ subject: "another-user" })
          .query(api.conversations.current, {})
      ).messages,
    ).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("directMessages").collect()),
    ).toEqual([]);
  });

  it("migrates before a new turn and exposes the preserved text to only that private context", async () => {
    const { user } = await setup();
    await user.mutation(api.conversations.begin, {
      key,
      messageId: "new-turn",
      text: "Thank you",
    });
    const context = await user.query(api.conversations.context, {
      key,
      messageId: "new-turn",
    });
    expect(context).toEqual(
      expect.arrayContaining([
        { role: "user", content: "What is my balance?" },
        { role: "assistant", content: "Your payments are not activated yet." },
        { role: "user", content: "Thank you" },
      ]),
    );
    expect(
      (await user.query(api.conversations.current, {})).messages,
    ).toHaveLength(3);
  });

  it("aborts the whole conversion for a mismatched legacy record", async () => {
    const { t, conversationId, ids } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(ids[1], {
        content: JSON.stringify({
          id: "wrong-id",
          role: "assistant",
          parts: [{ type: "text", text: "Keep original" }],
        }),
      }),
    );
    const before = await t.run((ctx) => ctx.db.query("messages").collect());
    await expect(
      t.mutation(internal.migrations.privateHistory, { cursor: null }),
    ).rejects.toThrow(/identity/);
    expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual(
      before,
    );
    expect(
      (await t.run((ctx) => ctx.db.get(conversationId)))?.agentThreadId,
    ).toBeUndefined();
  });
});
