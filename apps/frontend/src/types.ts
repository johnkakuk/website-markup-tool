export type Canvas = {
  id: string;
  name: string;
  site_url: string;
  site_origin: string;
  share_token: string;
  owner_id: string;
  created_at: string;
};

export type CommentStatus = "open" | "resolved";

export type Comment = {
  id: string;
  canvas_id: string;
  author_id: string;
  element_selector: string | null;
  element_id: string | null;
  data_selector: string | null;
  xpath: string | null;
  x_pct: number;
  y_pct: number;
  viewport_width: number;
  page_path: string;
  body: string;
  screenshot_path: string | null;
  screenshot_url: string | null;
  status: CommentStatus;
  created_at: string;
};

export type Reply = {
  id: string;
  comment_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type Attachment = {
  id: string;
  comment_id: string;
  uploader_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string | null;
};

export type PinPosition = {
  xPct: number;
  yPct: number;
  displaced: boolean;
};

export type ElementTarget = {
  elementSelector: string | null;
  elementId: string | null;
  dataSelector: string | null;
  xpath: string | null;
};
