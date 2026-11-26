import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../router';
import { campaignKeys } from '../api/queries';
import type { CampaignEditor, EditorStream } from '../api/types';
import { campaignEditor, editorOffer as o, editorStream as s } from './editor.fixtures';

const base = '/api/v1/campaigns/5/editor';
let server: CampaignEditor;
let calls: { path: string; body: Record<string, unknown> }[];
let responses: (() => Response | Promise<Response>)[];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  server = campaignEditor(); calls = []; responses = [];
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (init?.method === 'POST') {
      calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const reply = responses.shift();
      if (!reply) throw new Error('Unexpected POST');
      return reply();
    }
    if (path === base) return json(server);
    if (path.startsWith('/api/v1/offers?')) return json([1, 2, 3].map(id => ({ id, name: `Offer ${id}`, country: [], state: 'active', payout_value: 0, payout_currency: 'USD' })));
    if (path.includes('/campaigns?')) return json([server.campaign]);
    throw new Error(`Unexpected GET ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })) {
  const router = createMemoryRouter(routes, { initialEntries: ['/campaigns/5'] });
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></ConfigProvider>);
  return { ...view, client, router };
}
function replyStream(stream: EditorStream) {
  responses.push(() => { server = { ...server, streams: server.streams.map(old => old.stream.id === stream.stream.id ? stream : old) }; return json(stream); });
}
function reject(code: string, status = 422) { responses.push(() => json({ code, detail: `Server ${code}` }, status)); }
const region = () => within(screen.getByRole('region', { name: 'Поток 12' }));
async function ready() { await screen.findByRole('button', { name: 'Pin 1' }); }
async function click(name: string) { await userEvent.click(region().getByRole('button', { name })); }
async function settled() { await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument()); }
async function add(id = 2) {
  await userEvent.click(region().getByRole('combobox', { name: 'Оффер' }));
  await userEvent.click(await screen.findByText(`#${id} · Offer ${id}`));
  await click('Add'); await settled();
}

describe('editor workflow', () => {
  it('renders server offers, fractions, active zero and read-only streams without routing fields', async () => {
    server = campaignEditor([s({ offers: [o(1, 25.125, true, true), o(2, 0), o(3, 0, false)], total_share: 25.125, validation_error: 'Invalid total', dirty: true })]);
    mount(); await screen.findByRole('button', { name: 'Unpin 1' });
    expect(region().getByRole('button', { name: 'Доля оффера 1: 25.125%' })).toBeInTheDocument();
    expect(region().getByRole('button', { name: 'Доля оффера 2: 0%' })).toBeEnabled();
    expect(region().getByRole('button', { name: 'Bring Back' })).toBeInTheDocument();
    expect(region().getByText('Сумма долей: 25.125%')).toBeInTheDocument();
    expect(region().getByRole('button', { name: 'Push to KT' })).toBeDisabled();
    expect(screen.getByText('Invalid total')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Остальные потоки' })).toHaveTextContent('1. Geo');
    expect(screen.getByRole('link', { name: /View in KT/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(calls).toHaveLength(0);
  });
  it('adds, reloads draft, publishes, removes, publishes removed history, restores and cancels using fresh revisions', async () => {
    const first = mount(); await ready();
    await userEvent.click(region().getByRole('combobox', { name: 'Оффер' }));
    expect(screen.queryByText('#1 · Offer 1')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByText('#2 · Offer 2'));
    const added = s({ offers: [o(1, 50), o(2, 50)], dirty: true, revision: 2 }); replyStream(added);
    await click('Add'); await settled();
    expect(calls[0]).toEqual({ path: `${base}/streams/12/actions`, body: { action: 'add', offer_id: 2, revision: 1 } });
    expect(region().getByText('Черновик')).toBeInTheDocument();
    first.unmount(); const { client } = mount(); await ready();
    expect(region().getByRole('button', { name: 'Доля оффера 2: 50%' })).toBeInTheDocument();
    client.setQueryData(campaignKeys.detail(5), { old: true });
    client.setQueryData([...campaignKeys.lists, 1], []);
    const published = s({ ...added, dirty: false, revision: 3, published_offers: added.offers }); replyStream(published);
    await click('Push to KT'); await settled();
    expect(region().getByText('Публикация подтверждена')).toBeInTheDocument();
    expect(client.getQueryState(campaignKeys.detail(5))?.isInvalidated).toBe(true);
    expect(client.getQueryState([...campaignKeys.lists, 1])?.isInvalidated).toBe(true);
    const removed = s({ ...published, offers: [o(1, 100), o(2, 0, false)], dirty: true, revision: 4 }); replyStream(removed);
    await userEvent.click(within(region().getByText('Offer 2').closest('tr')!).getByRole('button', { name: 'Remove' })); await settled();
    replyStream(s({ ...removed, dirty: false, revision: 5, published_offers: removed.offers }));
    await click('Push to KT'); await settled();
    expect(region().getByRole('button', { name: 'Bring Back' })).toBeEnabled();
    replyStream(s({ ...added, revision: 6, published_offers: removed.offers })); await click('Bring Back'); await settled();
    replyStream(s({ ...removed, dirty: false, revision: 7, published_offers: removed.offers })); await click('Cancel'); await settled();
    expect(region().getByRole('button', { name: 'Bring Back' })).toBeEnabled();
    expect(calls.map(c => c.body.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(calls.map(c => c.path.split('/').at(-1))).toEqual(['actions', 'publish', 'actions', 'publish', 'actions', 'cancel']);
  });
  it('pins, unpins, edits pinned shares by Enter, validates integers and cancels input by Escape', async () => {
    server = campaignEditor([s({ offers: [o(1, 25.5), o(2, 74.5)] })]);
    mount(); await ready();
    replyStream(s({ offers: [o(1, 25.5, true, true), o(2, 74.5)], dirty: true, revision: 2 }));
    await click('Pin 1'); await settled();
    await click('Доля оффера 1: 25.5%');
    const input = region().getByRole('spinbutton', { name: 'Доля оффера 1' });
    fireEvent.change(input, { target: { value: '1.5' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Введите целое число от 0 до 100.')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(region().getByRole('button', { name: 'Доля оффера 1: 25.5%' })).toBeInTheDocument();
    await click('Доля оффера 1: 25.5%');
    replyStream(s({ offers: [o(1, 40, true, true), o(2, 60)], dirty: true, revision: 3 }));
    fireEvent.change(region().getByRole('spinbutton'), { target: { value: '40' } });
    fireEvent.keyDown(region().getByRole('spinbutton'), { key: 'Enter' }); await settled();
    await screen.findByRole('button', { name: 'Доля оффера 1: 40%' });
    expect(calls[1].body).toEqual({ revision: 2, action: 'share', offer_id: 1, share: 40 });
    replyStream(s({ offers: [o(1, 50), o(2, 50)], dirty: true, revision: 4 }));
    await click('Unpin 1'); await settled();
    expect(region().getByRole('button', { name: 'Доля оффера 2: 50%' })).toBeInTheDocument();
  });
  it('allows pin-only publication and adding to an empty landings stream', async () => {
    mount(); await ready(); replyStream(s({ offers: [o(1, 100, true, true)], dirty: true, revision: 2 }));
    await click('Pin 1'); await settled(); expect(region().getByRole('button', { name: 'Push to KT' })).toBeEnabled();
    replyStream(s({ offers: [o(1, 100, true, true)], dirty: false, revision: 3 }));
    await click('Push to KT'); await settled(); expect(calls[1].body).toEqual({ revision: 2 });
  });
  it('shows an empty editable stream and permits Add', async () => {
    server = campaignEditor([s({ offers: [], published_offers: [], total_share: 0, validation_error: 'At least one active offer is required' })]);
    mount(); await screen.findByText('В потоке нет офферов. Добавьте первый оффер.');
    replyStream(s({ offers: [o(2, 100)], dirty: true, revision: 2 })); await add();
    expect(region().getByRole('button', { name: 'Доля оффера 2: 100%' })).toBeInTheDocument();
  });
  it('retains missing drafts for viewing, allows only Cancel and removes orphan through GET', async () => {
    server = campaignEditor([s({ missing: true, editable: false, dirty: true })]);
    mount(); await ready();
    expect(region().getByRole('button', { name: 'Pin 1' })).toBeDisabled();
    expect(region().getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(region().getByRole('button', { name: 'Push to KT' })).toBeDisabled();
    responses.push(() => { server = campaignEditor([]); return json(s({ revision: 2 })); });
    await click('Cancel'); await screen.findByText('Нет потоков для редактирования');
    expect(calls[0].body).toEqual({ revision: 1 });
  });
});

describe('synchronization and failures', () => {
  it('fetches with {}, confirms all dirty revisions, leaves drafts untouched on dismissal', async () => {
    server = campaignEditor([s({ dirty: true, revision: 7 }), s({ stream: { ...s().stream, id: 13, name: 'Second' }, dirty: true, revision: 9 })]);
    mount(); await screen.findByText('Second');
    reject('draft_conflict', 409);
    await userEvent.click(screen.getByRole('button', { name: /Fetch Streams/ }));
    await screen.findByRole('dialog'); expect(calls[0].body).toEqual({});
    await userEvent.click(screen.getByRole('button', { name: 'Оставить черновики' }));
    expect(calls).toHaveLength(1); expect(screen.getAllByText('Черновик')).toHaveLength(2);
    reject('draft_conflict', 409); await userEvent.click(screen.getByRole('button', { name: /Fetch Streams/ }));
    await screen.findByRole('dialog');
    responses.push(() => { server = campaignEditor([s({ offers: [o(1, 80), o(2, 20)], revision: 10 })]); return json(server); });
    await userEvent.click(screen.getByRole('button', { name: 'Отбросить и получить' })); await settled();
    expect(calls[2].body).toEqual({ discard_drafts: true, revisions: { '12': 7, '13': 9 } });
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
    expect(region().getByRole('button', { name: 'Доля оффера 1: 80%' })).toBeInTheDocument();
  });
  it('Fetch without drafts replaces entire editor with exact server normalization draft', async () => {
    mount(); await ready(); responses.push(() => { server = campaignEditor([s({ offers: [o(1, 25, true, true), o(2, 75), o(3, 0, false)], dirty: true, revision: 2 })]); return json(server); });
    await userEvent.click(screen.getByRole('button', { name: /Fetch Streams/ })); await settled();
    expect(calls[0].body).toEqual({}); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(region().getByRole('button', { name: 'Доля оффера 2: 75%' })).toBeInTheDocument();
    expect(region().getByRole('button', { name: 'Bring Back' })).toBeInTheDocument();
  });
  it.each(['no_free_share', 'last_offer', 'duplicate_offer', 'invalid_distribution', 'offer_not_found', 'inactive_offer'])('keeps displayed state on %s', async code => {
    mount(); await ready(); reject(code); await click('Remove'); await settled();
    await screen.findByText(new RegExp(`Server ${code}`));
    expect(region().getByRole('button', { name: 'Доля оффера 1: 100%' })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });
  it('recovers revision conflict via GET, then uses the new revision without automatic POST', async () => {
    mount(); await ready(); responses.push(() => { server = campaignEditor([s({ revision: 8, offers: [o(1, 100, true, true)], dirty: true })]); return json({ code: 'revision_conflict', detail: 'Changed' }, 409); });
    await click('Pin 1'); await screen.findByRole('button', { name: 'Unpin 1' }); await settled();
    expect(calls).toHaveLength(1);
    replyStream(s({ revision: 9 })); await click('Unpin 1'); await settled();
    expect(calls[1].body.revision).toBe(8);
  });
  it('retains draft on upstream conflict and never fetches automatically', async () => {
    server = campaignEditor([s({ dirty: true, revision: 3 })]); mount(); await ready(); reject('upstream_conflict', 409);
    await click('Push to KT'); await settled();
    expect(region().getByText('Черновик')).toBeInTheDocument();
    expect(screen.getByText(/Поток изменён в Keitaro/)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });
  it.each(['publication_unknown', 'network_error'])('reconciles %s with GET, requires explicit publish retry using latest revision', async code => {
    server = campaignEditor([s({ dirty: true, revision: 3 })]); mount(); await ready();
    responses.push(() => { server = campaignEditor([s({ dirty: true, revision: 4 })]); if (code === 'network_error') throw new TypeError('lost'); return json({ code, detail: 'Lost response' }, 502); });
    await click('Push to KT'); await settled();
    await screen.findByText('Результат публикации не подтверждён'); expect(calls).toHaveLength(1);
    replyStream(s({ revision: 5 })); await click('Push to KT'); await settled();
    expect(calls[1].body).toEqual({ revision: 4 });
    expect(region().getByText('Публикация подтверждена')).toBeInTheDocument();
  });
  it('recovers lost local response and storage failures with GET', async () => {
    mount(); await ready(); responses.push(() => { server = campaignEditor([s({ offers: [o(1, 100, true, true)], dirty: true, revision: 2 })]); throw new TypeError('lost'); });
    await click('Pin 1'); await settled();
    expect(region().getByRole('button', { name: 'Unpin 1' })).toBeInTheDocument();
    reject('editor_storage_unavailable', 503); await click('Unpin 1'); await settled();
    expect(region().getByRole('button', { name: 'Unpin 1' })).toBeInTheDocument();
    expect(calls.map(c => c.body.revision)).toEqual([1, 2]);
  });
  it('blocks further changes if recovery GET fails and allows explicit GET recovery', async () => {
    mount(); await ready(); const original = fetchMock.getMockImplementation()!;
    let failGet = false;
    fetchMock.mockImplementation((input, init) => failGet && String(input) === base && init?.method !== 'POST' ? Promise.resolve(json({ detail: 'offline' }, 503)) : original(input, init));
    responses.push(() => { failGet = true; throw new TypeError('lost'); });
    await click('Pin 1'); await screen.findByText('Нужно уточнить состояние редактора'); await settled();
    expect(region().getByRole('button', { name: 'Pin 1' })).toBeDisabled();
    expect(region().getByRole('button', { name: 'Доля оффера 1: 100%' })).toBeInTheDocument();
    failGet = false; await userEvent.click(screen.getByRole('button', { name: 'Загрузить состояние' })); await settled();
    expect(region().getByRole('button', { name: 'Pin 1' })).toBeEnabled(); expect(calls).toHaveLength(1);
  });
  it('serializes double clicks and Fetch, prevents a late cancelled GET from overwriting mutation state', async () => {
    const { client } = mount(); await ready();
    let resolveGet!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveGet = resolve; }));
    const oldGet = client.fetchQuery({ queryKey: campaignKeys.editor(5), queryFn: () => fetchMock(base).then(r => r.json() as Promise<CampaignEditor>), staleTime: 0 });
    let resolvePost!: (response: Response) => void;
    responses.push(() => new Promise(resolve => { resolvePost = resolve; }));
    // Let the mutation cancel an already issued GET before the fetching render disables UI.
    fireEvent.click(region().getByRole('button', { name: 'Pin 1' }));
    fireEvent.click(region().getByRole('button', { name: 'Pin 1' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Fetch Streams/ })).toBeDisabled();
    const updated = s({ revision: 2, dirty: true, offers: [o(1, 100, true, true)] });
    await act(async () => resolvePost(json(updated))); await settled();
    await act(async () => { resolveGet(json(campaignEditor())); await oldGet.catch(() => undefined); });
    expect(region().getByRole('button', { name: 'Unpin 1' })).toBeInTheDocument(); expect(calls).toHaveLength(1);
  });
});
