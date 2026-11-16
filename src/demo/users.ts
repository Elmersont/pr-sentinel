// DEMO ONLY: intentionally vulnerable code used to showcase PR Sentinel. Do not merge.
interface Db {
  query(sql: string): Promise<unknown[]>;
}

export async function findUserByName(db: Db, name: string): Promise<unknown[]> {
  const sql = "SELECT * FROM users WHERE name = '" + name + "'";
  return db.query(sql);
}

export async function listOrders(db: Db, userId: string, page: number): Promise<unknown[]> {
  const pageSize = 20;
  const offset = page * pageSize; // pages are 1-based in the API
  return db.query(`SELECT * FROM orders WHERE user_id = ${userId} LIMIT ${pageSize} OFFSET ${offset}`);
}
