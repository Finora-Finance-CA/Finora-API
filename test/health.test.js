import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { pingDatabase } from './support/fakeDatabase.js';

const app = createApp();

describe('GET /health', () => {
  it('returns 200 and a healthy database when the database answers, without a token', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 without the reason when the database is unreachable', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    pingDatabase.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432'));

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', database: 'unreachable' });
    expect(response.text).not.toContain('ECONNREFUSED');
    expect(logged).toHaveBeenCalled();
  });
});
