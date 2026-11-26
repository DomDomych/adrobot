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
  action_type: string | null;
  action_payload: string | null;
  filters: { name: string; mode: string; payload: string[] }[];
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
