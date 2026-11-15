jest.mock('../../src/database/pool', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock('../../src/modules/agent/tool-registry', () => ({
  executeTool: jest.fn(),
}));
jest.mock('../../src/modules/cameras/camera-discovery.service', () => ({
  findCandidatesForCase: jest.fn(),
}));

const { query, withTransaction } = require('../../src/database/pool');
const { executeTool } = require('../../src/modules/agent/tool-registry');
const jobs = require('../../src/modules/agent/tracking-jobs.service');

describe('durable investigation tracking jobs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueues a scoped idempotent job and returns its persisted lifecycle state', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'job-id', caseId: 'case-id', status: 'QUEUED', mode: 'HYBRID' }] });
    const job = await jobs.enqueue({ caseId: 'case-id', plate: 'CASE_TARGET', mode: 'HYBRID', requestKey: 'request-key' });
    expect(job).toMatchObject({ id: 'job-id', caseId: 'case-id', status: 'QUEUED', mode: 'HYBRID' });
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (case_id, request_key)');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['case-id', 'CASE_TARGET', 'HYBRID', 'request-key']));
  });

  test('claims one available job with row locking so worker replicas do not share a claim', async () => {
    let claimSql = '';
    withTransaction.mockImplementation(async (callback) => callback({
      query: jest.fn().mockImplementation(async (text) => {
        claimSql = text;
        return { rows: [{ id: 'job-id', status: 'RUNNING' }] };
      }),
    }));
    const claimed = await jobs.claimOne();
    expect(claimed).toMatchObject({ id: 'job-id', status: 'RUNNING' });
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
  });

  test('completes a historic job from persisted detections without inventing observations', async () => {
    const now = new Date();
    query
      .mockResolvedValueOnce({ rows: [{ id: 'case-id', status: 'OPEN' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    executeTool.mockResolvedValueOnce({ found: false, points: [], segments: [] });

    await jobs.processJob({
      id: 'job-id', case_id: 'case-id', target_plate: 'CASE_TARGET', mode: 'HISTORIC',
      status: 'RUNNING', requested_at: now, expires_at: new Date(now.getTime() + 60000),
      cursor_detection_id: 0, result: {}, lease_token: 'lease-id',
    });

    expect(executeTool).toHaveBeenCalledWith('get_vehicle_trajectory', { plate: 'CASE_TARGET', caseId: 'case-id' });
    expect(query.mock.calls[1][1][2]).toBe('COMPLETED');
    const persisted = JSON.parse(query.mock.calls[1][1][3]);
    expect(persisted.observedPoints).toEqual([]);
    expect(persisted.historicLoaded).toBe(true);
  });

  test('live mode waits for new ingested detections and retains a bounded case query', async () => {
    const now = new Date();
    query
      .mockResolvedValueOnce({ rows: [{ id: 'case-id', status: 'OPEN' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await jobs.processJob({
      id: 'job-id', case_id: 'case-id', target_plate: 'CASE_TARGET', mode: 'LIVE',
      status: 'RUNNING', requested_at: now, expires_at: new Date(now.getTime() + 60000),
      cursor_detection_id: 0, result: {}, lease_token: 'lease-id',
    });

    const observationQuery = query.mock.calls[1][0];
    expect(observationQuery).toContain('d.ingested_at >= $3');
    expect(observationQuery).toContain('i.search_start_at');
    expect(observationQuery).toContain('i.search_end_at');
    expect(query.mock.calls[2][1][2]).toBe('WAITING_FOR_OBSERVATIONS');
  });
});

