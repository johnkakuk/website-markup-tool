import html2canvas from "html2canvas";
import { supabase } from "./supabase";

export async function captureAndUploadScreenshot(
  documentRef: Document,
  canvasId: string,
  commentId: string,
  marker: { x: number; y: number }
) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const element = documentRef.documentElement;
  const rendered = await html2canvas(element, {
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    windowWidth: documentRef.defaultView?.innerWidth,
    windowHeight: documentRef.defaultView?.innerHeight,
    scrollX: documentRef.defaultView?.scrollX ?? 0,
    scrollY: documentRef.defaultView?.scrollY ?? 0
  });

  const context = rendered.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(239, 68, 68, 0.18)";
    context.strokeStyle = "#ef4444";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(marker.x, marker.y, 18, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    rendered.toBlob((value) => {
      if (value) {
        resolve(value);
      } else {
        reject(new Error("Screenshot capture failed."));
      }
    }, "image/png");
  });

  const path = `${canvasId}/${commentId}.png`;
  const { error } = await supabase.storage
    .from("comment-screenshots")
    .upload(path, blob, {
      contentType: "image/png",
      upsert: true
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from("comment-screenshots").getPublicUrl(path);
  return data.publicUrl;
}
