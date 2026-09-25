import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const recordSchema = z.object({
  id: z.string(),
  account: z.string(),
  kind: z.enum(["deploy", "fund", "transfer"]),
  state: z.enum(["review", "preparing", "pending", "confirmed", "failed"]),
  func: z.string(),
  auth: z.string(),
  expires: z.number(),
  created: z.number(),
  hash: z.string().nullable(),
  envelope: z.string().nullable(),
  ledger: z.number().nullable(),
  error: z.string().nullable(),
});

export type RecordEntry = z.infer<typeof recordSchema>;

export class SponsorStore {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
        func TEXT NOT NULL, auth TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL,
        hash TEXT, envelope TEXT, ledger INTEGER, error TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sponsor_inflight ON jobs ((1)) WHERE state IN ('preparing','pending');
      CREATE UNIQUE INDEX IF NOT EXISTS once_per_account ON jobs (account,kind)
        WHERE kind IN ('deploy','fund') AND state != 'failed';
      CREATE TABLE IF NOT EXISTS limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
    `);
  }
  get(id: string) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);

    return row ? recordSchema.parse(row) : null;
  }
  accountJobs(account: string) {
    return this.db
      .prepare(`SELECT * FROM jobs WHERE account = ? AND (kind != 'transfer' OR id IN
      (SELECT id FROM jobs WHERE account = ? AND kind = 'transfer' ORDER BY created DESC LIMIT 20))
      ORDER BY created DESC`)
      .all(account, account)
      .map((row) => recordSchema.parse(row));
  }
  insert(
    id: string,
    account: string,
    kind: RecordEntry["kind"],
    func: string,
    auth: string,
    expires: number,
  ) {
    this.db
      .prepare(
        "INSERT INTO jobs (id,account,kind,state,func,auth,expires,created) VALUES (?,?,?,'review',?,?,?,?)",
      )
      .run(id, account, kind, func, auth, expires, Date.now());

    return this.get(id)!;
  }
  // Durable global budgets; do not trust spoofable forwarding/IP headers.
  rate(bucket: string, maximum: number) {
    const result = this.db
      .prepare(`INSERT INTO limits VALUES (?,1) ON CONFLICT(bucket)
      DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`)
      .get(bucket, maximum);

    if (!result)
      throw new Error(
        "Testnet validation budget reached. Try again in the next window.",
      );
  }
  claim(id: string) {
    const job = this.get(id);

    if (!job) throw new Error("Unknown transaction intent.");

    if (job.state !== "review") return false;

    if (job.expires < Date.now())
      throw new Error("Review expired. Prepare a new transfer.");

    try {
      return (
        this.db
          .prepare(
            "UPDATE jobs SET state='preparing' WHERE id=? AND state='review'",
          )
          .run(id).changes === 1
      );
    } catch {
      throw new Error(
        "Sponsor has an unresolved transaction. Refresh its status before submitting another.",
      );
    }
  }
  pending(id: string, hash: string, envelope: string) {
    const result = this.db
      .prepare(
        "UPDATE jobs SET state='pending',hash=?,envelope=? WHERE id=? AND state='preparing'",
      )
      .run(hash, envelope, id);

    if (result.changes !== 1)
      throw new Error("Submission reservation was lost.");
  }
  finish(
    id: string,
    state: "confirmed" | "failed",
    ledger: number | null,
    error: string | null,
  ) {
    this.db
      .prepare("UPDATE jobs SET state=?,ledger=?,error=? WHERE id=?")
      .run(state, ledger, error, id);
  }
  close() {
    this.db.close();
  }
}
