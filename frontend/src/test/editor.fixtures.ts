import type { CampaignEditor, EditorOffer, EditorStream } from '../api/types';
export const editorOffer = (id: number, share: number, active = true, pinned = false): EditorOffer => ({ offer_id: id, name: `Offer ${id}`, share, active, pinned });
export function editorStream(overrides: Partial<EditorStream> = {}): EditorStream {
  return {
    stream: { id: 12, name: 'Offers', campaign_id: 5, type: 'default', schema: 'landings', position: 2, offers: [{ offer_id: 1, share: 100, state: 'active' }] },
    editable: true, offers: [editorOffer(1, 100)], published_offers: [editorOffer(1, 100)], dirty: false,
    revision: 1, total_share: 100, validation_error: null, missing: false, ...overrides,
  };
}
export function campaignEditor(streams: EditorStream[] = [editorStream()]): CampaignEditor {
  return { campaign: { id: 5, name: 'test_panesh_editor', alias: 'demo', state: 'active', domain_id: 1813, group_id: 10332, traffic_source_id: 836 },
    streams: [...streams, { stream: { id: 11, campaign_id: 5, name: 'Geo', schema: 'redirect', type: 'regular', position: 1, offers: [] },
      editable: false, offers: [], published_offers: [], dirty: false, revision: null, total_share: 0, validation_error: null, missing: false }] };
}
