export type Canvas = {
  id: string;
  name: string;
  site_url: string;
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
