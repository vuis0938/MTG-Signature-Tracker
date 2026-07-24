import { Pool } from "pg";
import { NextResponse } from "next/server";

export async function GET() {
  const pool = new Pool({
    host: "db.gucrczqrmznfsutzdbhs.supabase.co",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: "0j3b0q5wMTG",
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(`UPDATE decks SET user_name = 'vuis' WHERE user_name = '默认用户'`);
    await pool.end();
    return NextResponse.json({ success: true, message: "已迁移旧数据到 vuis" });
  } catch (error) {
    await pool.end();
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
