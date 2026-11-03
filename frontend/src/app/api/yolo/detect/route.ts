import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, cameraId = "CAM-01" } = body;

    if (!image) {
      return NextResponse.json({ success: false, detected: false, message: "No frame image provided" }, { status: 400 });
    }

    const aiServiceUrl = (process.env.AI_SERVICE_URL || process.env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:8000").replace(/\/+$/, "");

    try {
      const response = await fetch(`${aiServiceUrl}/detect-plate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, cameraId }),
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }
      return NextResponse.json(
        { success: false, detected: false, error: "AI_SERVICE_ERROR", message: `AI microservice returned HTTP ${response.status}` },
        { status: 502 }
      );
    } catch {
      return NextResponse.json(
        { success: false, detected: false, error: "AI_SERVICE_UNAVAILABLE", message: "AI microservice is unavailable or timed out" },
        { status: 503 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, detected: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
