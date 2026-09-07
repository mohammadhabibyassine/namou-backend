import { bullMqConnectionFromUrl } from './redis-connection.js';

describe('bullMqConnectionFromUrl', () => {
  it('maps an authenticated TLS URL without leaking parsing into modules', () => {
    expect(
      bullMqConnectionFromUrl('rediss://user:p%40ss@redis.example:6380/3'),
    ).toEqual({
      host: 'redis.example',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 3,
      tls: {},
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  });
});
