import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const urlParameters = new URLSearchParams(window.location.search);
const requestedShareToken = urlParameters.get("share");

export const canvasShareToken =
  requestedShareToken &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    requestedShareToken
  )
    ? requestedShareToken
    : null;

export const hasCanvasShareLink = Boolean(urlParameters.get("canvas") && canvasShareToken);

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      global: canvasShareToken
        ? { headers: { "x-canvas-share-token": canvasShareToken } }
        : undefined
    })
  : null;
