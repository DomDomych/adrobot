export interface Campaign {
  id: number;
  name: string;
  alias: string | null;
  domain_id: number | null;
  group_id: number | null;
  traffic_source_id: number | null;
  state: string | null;
}
export interface Offer {
  id: number;
  name: string;
  country: string[];
  state: string;
  payout_value: number;
  payout_currency: string;
}
export interface Stream {
  id: number;
  name: string;
  campaign_id: number;
  type: string;
  schema: string;
  position: number | null;
  action_type?: string | null;
  action_payload?: string | null;
  filters?: { name: string; mode: string; payload: string[] }[];
  offers: { offer_id: number; share: number; state: string }[];
}
export interface CampaignDetails {
  campaign: Campaign;
  streams: Stream[];
}
export interface CreateCampaignRequest {
  name: string;
  geo: string;
  offer_id: number;
}

export interface EditorOffer {
  offer_id: number;
  name: string;
  share: number;
  active: boolean;
  pinned: boolean;
}
export interface EditorStream {
  stream: Stream;
  editable: boolean;
  offers: EditorOffer[];
  published_offers: EditorOffer[];
  dirty: boolean;
  revision: number | null;
  total_share: number;
  validation_error: string | null;
  missing: boolean;
}
export interface CampaignEditor {
  campaign: Campaign;
  streams: EditorStream[];
}
export type OfferAction =
  | { action: "add" | "remove" | "restore" | "pin" | "unpin"; offer_id: number }
  | { action: "share"; offer_id: number; share: number };
export type EditorAction = OfferAction & { revision: number };
export interface FetchEditorRequest {
  discard_drafts?: boolean;
  revisions?: Record<string, number>;
}
