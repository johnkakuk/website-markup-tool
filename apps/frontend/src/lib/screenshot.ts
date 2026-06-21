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

  const windowRef = documentRef.defaultView;
  if (!windowRef) {
    throw new Error("The canvas window is not available.");
  }

  const element = documentRef.documentElement;
  const viewportWidth = windowRef.innerWidth;
  const viewportHeight = windowRef.innerHeight;
  const viewport = await html2canvas(element, {
    backgroundColor: "#ffffff",
    height: viewportHeight,
    logging: false,
    scale: 1,
    scrollX: windowRef.scrollX,
    scrollY: windowRef.scrollY,
    useCORS: true,
    width: viewportWidth,
    windowHeight: viewportHeight,
    windowWidth: viewportWidth,
    x: windowRef.scrollX,
    y: windowRef.scrollY
  });

  const cropWidth = Math.min(500, viewport.width);
  const cropHeight = Math.min(500, viewport.height);
  const cropLeft = clamp(marker.x - cropWidth / 2, 0, viewport.width - cropWidth);
  const cropTop = clamp(marker.y - cropHeight / 2, 0, viewport.height - cropHeight);
  const focused = documentRef.createElement("canvas");
  focused.width = cropWidth;
  focused.height = cropHeight;

  const context = focused.getContext("2d");
  if (!context) {
    throw new Error("Screenshot canvas is not available.");
  }

  context.drawImage(
    viewport,
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  context.fillStyle = "rgba(239, 68, 68, 0.18)";
  context.strokeStyle = "#ef4444";
  context.lineWidth = 4;
  context.beginPath();
  context.arc(marker.x - cropLeft, marker.y - cropTop, 18, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  const blob = await new Promise<Blob>((resolve, reject) => {
    focused.toBlob((value) => {
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

  return path;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
