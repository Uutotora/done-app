import { describe, expect, it } from 'vitest';
import { itemToIssuePayload, planeReady, toIssueLite } from '@/lib/plane';
import { formatScore, riceScore } from '@/lib/rice';
import type { Item } from '@/lib/types';
import { PLANE_DEFAULTS } from '@/lib/constants';

describe('Plane mapping', () => {
  it('reads issues whether state is an id or an expanded object', () => {
    expect(toIssueLite({ id: 'i1', name: 'Fix', sequence_id: 42, state: 's1', priority: 'high', target_date: '2026-10-01' })).toEqual({
      id: 'i1',
      name: 'Fix',
      sequenceId: 42,
      stateId: 's1',
      priority: 'high',
      startDate: undefined,
      targetDate: '2026-10-01',
      updatedAt: undefined,
    });
    expect(toIssueLite({ id: 'i2', name: 'X', sequence_id: 1, state: { id: 's2' }, priority: 'weird' })).toMatchObject({
      stateId: 's2',
      priority: 'none',
    });
  });

  it('builds an issue payload with escaped HTML and dates', () => {
    const item: Item = {
      id: 'x',
      projectId: 'p',
      type: 'feature',
      title: 'Phone sign-up',
      status: 'planned',
      priority: 'urgent',
      tags: [],
      order: 0,
      startDate: '2026-10-01',
      dueDate: '2026-10-10',
      content: [{ type: 'paragraph', content: '<b>bold</b> & more' }],
      createdAt: '',
      updatedAt: '',
    };
    const payload = itemToIssuePayload(item, 'en');
    expect(payload).toMatchObject({ name: 'Phone sign-up', priority: 'urgent', start_date: '2026-10-01', target_date: '2026-10-10' });
    expect(payload.description_html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; more');
    expect(payload.description_html).toContain('Created in Done');
  });

  it('needs a key and a workspace slug to be ready', () => {
    expect(planeReady({ ...PLANE_DEFAULTS, workspaceSlug: '', apiKey: 'k', autoStatus: true })).toBe(false);
    expect(planeReady({ ...PLANE_DEFAULTS, workspaceSlug: 'acme', apiKey: 'k', autoStatus: true })).toBe(true);
  });
});

describe('RICE', () => {
  it('computes reach × impact × confidence / effort', () => {
    expect(riceScore({ reach: 4000, impact: 2, confidence: 80, effort: 2 })).toBe(3200);
    expect(riceScore({ reach: 0, impact: 2, confidence: 80, effort: 2 })).toBeUndefined();
    expect(riceScore(undefined)).toBeUndefined();
    expect(formatScore(3200)).toBe('3.2k');
    expect(formatScore(15000)).toBe('15k');
    expect(formatScore(640)).toBe('640');
  });
});
