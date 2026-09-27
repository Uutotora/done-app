import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { ANIMAL_AVATARS, defaultAnimalAvatar, isAnimalAvatar, isValidAvatar, randomAnimalAvatar } from '../shared/avatars.mjs';
import { personAnimalAvatar } from '@/lib/avatars';
import { createEmptyData, useData } from '@/lib/store';

describe('animal avatar defaults', () => {
  it('keeps all 24 ids unique and selects a stable animal for old profiles', () => {
    expect(ANIMAL_AVATARS).toHaveLength(24);
    expect(new Set(ANIMAL_AVATARS.map(({ id }) => id)).size).toBe(24);
    const person = { id: 'old-profile-id' };
    const expected = defaultAnimalAvatar(person.id);
    expect(isAnimalAvatar(expected)).toBe(true);
    expect(personAnimalAvatar(person)).toBe(expected);
    expect(personAnimalAvatar({ ...person })).toBe(expected);
    expect(person).not.toHaveProperty('avatar');
    expect(personAnimalAvatar({ ...person, avatar: 'animal:fox' })).toBe('animal:fox');
  });

  it('does not repeat the current animal when shuffling and rejects unknown atlas ids', () => {
    for (const animal of ANIMAL_AVATARS) {
      const current = `animal:${animal.id}`;
      const next = randomAnimalAvatar(current);
      expect(next).not.toBe(current);
      expect(isAnimalAvatar(next)).toBe(true);
      expect(isValidAvatar(current)).toBe(true);
    }
    for (const invalid of ['animal:missing', 'animal:../../secret', {}, 10, '🐱'.repeat(40)]) expect(isValidAvatar(invalid)).toBe(false);
    for (const value of [undefined, null, '', '🐱', '🧑‍🚀']) expect(isValidAvatar(value)).toBe(true);
  });

  it('persists defaults for new local profiles while retaining a supplied custom emoji', () => {
    const data = createEmptyData('en', 'Alex');
    expect(isAnimalAvatar(data.people[data.meId].avatar)).toBe(true);
    useData.getState().replaceAll(data);
    const id = useData.getState().addPerson({ name: 'Teammate', color: 'blue' });
    const saved = useData.getState().people[id].avatar;
    expect(isAnimalAvatar(saved)).toBe(true);
    useData.getState().updatePerson(id, { name: 'Renamed' });
    expect(useData.getState().people[id].avatar).toBe(saved);
    const custom = useData.getState().addPerson({ name: 'Emoji', color: 'green', avatar: '🌱' });
    expect(useData.getState().people[custom].avatar).toBe('🌱');
  });
});

describe('animal avatar persistence and permissions', () => {
  let server: Server;
  let url: string;
  let api: ReturnType<typeof createAuthApi>;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
    fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const load = async (who = 'owner') => (await call('/api/workspace', 'GET', undefined, who)).json();
  const select = async (who: string, id: string, avatar: unknown) => {
    const before = (await load(who)).data.people[id];
    return call('/api/workspace', 'PATCH', { changes: { records: { people: { [id]: { before, after: { ...before, avatar } } } } } }, who);
  };

  beforeAll(async () => {
    api = createAuthApi({ filename: ':memory:' });
    server = createServer(api.handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const owner = await call(
      '/api/auth/register',
      'POST',
      {
        name: 'Owner',
        email: 'owner@example.com',
        password: 'a-long-owner-password',
        data: createEmptyData('en'),
      },
      '',
    );
    cookies.owner = owner.headers.get('set-cookie')!.split(';')[0];
    ids.owner = (await owner.json()).user.id;
    const invite = await (await call('/api/admin/invites', 'POST', { email: 'viewer@example.com', role: 'viewer', projectIds: [] })).json();
    const viewer = await call(
      '/api/auth/register',
      'POST',
      {
        name: 'Viewer',
        email: 'viewer@example.com',
        password: 'a-long-viewer-password',
        invite: invite.token,
      },
      '',
    );
    cookies.viewer = viewer.headers.get('set-cookie')!.split(';')[0];
    ids.viewer = (await viewer.json()).user.id;
  });

  afterAll(async () => {
    api.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('assigns a valid saved avatar to both the workspace creator and invited members', async () => {
    const { data } = await load();
    for (const id of Object.values(ids)) expect(isAnimalAvatar(data.people[id].avatar)).toBe(true);
    const reloaded = await load('viewer');
    expect(reloaded.data.people[ids.viewer].avatar).toBe(data.people[ids.viewer].avatar);
  });

  it('lets a viewer select their avatar, persists it for teammates and prevents editing another profile', async () => {
    expect((await select('viewer', ids.viewer, 'animal:capybara')).status).toBe(200);
    expect((await load()).data.people[ids.viewer].avatar).toBe('animal:capybara');
    expect((await select('viewer', ids.owner, 'animal:fox')).status).toBe(403);
    expect((await select('viewer', ids.viewer, 'animal:unknown')).status).toBe(400);
    expect((await load('viewer')).data.people[ids.viewer].avatar).toBe('animal:capybara');
    expect((await select('viewer', ids.viewer, '🌱')).status).toBe(200);
    expect((await load()).data.people[ids.viewer].avatar).toBe('🌱');
  });
});
