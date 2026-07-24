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
    // 创建用户表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 插入当前用户
    await pool.query(`
      INSERT INTO users (username, password)
      VALUES ('vuis', 'vuis0938')
      ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password;
    `);

    await pool.end();
    return NextResponse.json({ success: true, message: "用户表已创建，vuis 已注册" });
  } catch (error) {
    await pool.end();
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
