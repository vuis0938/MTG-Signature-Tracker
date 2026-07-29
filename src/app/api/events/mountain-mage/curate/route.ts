import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

interface CuratedSection {
  name: string;
  deadline: string | null;
  artists: string[];
}

interface CuratedData {
  updatedAt: string;
  sections: CuratedSection[];
}

export async function POST(request: Request) {
  try {
    const body: CuratedData = await request.json();

    if (!body.sections || !Array.isArray(body.sections)) {
      return NextResponse.json({ error: "无效数据格式" }, { status: 400 });
    }

    const filePath = path.join(
      process.cwd(),
      "src/data/mountain-mage-curated.json"
    );

    const data: CuratedData = {
      updatedAt: new Date().toISOString(),
      sections: body.sections,
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      sections: data.sections.length,
      artists: data.sections.reduce((sum, s) => sum + s.artists.length, 0),
    });
  } catch (error) {
    console.error("[Curate API]", error);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}