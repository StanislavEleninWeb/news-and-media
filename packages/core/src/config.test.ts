import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config';

describe('parseConfig', () => {
  it('applies development defaults', () => {
    const config = parseConfig({});
    expect(config.APP_ENV).toBe('development');
    expect(config.APP_URL).toBe('http://localhost:3000');
    expect(config.SCHEDULER_ENABLED).toBe(false);
    expect(config.isProduction).toBe(false);
  });

  it('enables the scheduler by default only in production', () => {
    const config = parseConfig({
      APP_ENV: 'production',
      APP_URL: 'https://news.example.com',
      DATABASE_URL: 'postgres://u:p@db:5432/news',
      TYPESENSE_URL: 'http://typesense:8108',
      TYPESENSE_API_KEY: 'k',
    });
    expect(config.SCHEDULER_ENABLED).toBe(true);
    expect(config.TYPESENSE_COLLECTION_PREFIX).toBe('production_');
  });

  it('lets an explicit flag override the default', () => {
    expect(parseConfig({ SCHEDULER_ENABLED: 'true' }).SCHEDULER_ENABLED).toBe(true);
    expect(
      parseConfig({
        APP_ENV: 'production',
        APP_URL: 'https://news.example.com',
        DATABASE_URL: 'postgres://x',
        TYPESENSE_URL: 'http://typesense:8108',
        TYPESENSE_API_KEY: 'k',
        SCHEDULER_ENABLED: 'false',
      }).SCHEDULER_ENABLED,
    ).toBe(false);
  });

  it('requires a database and public URL outside development', () => {
    expect(() => parseConfig({ APP_ENV: 'staging' })).toThrow(ConfigError);
    try {
      parseConfig({ APP_ENV: 'production' });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('APP_URL');
    }
  });

  it('treats blank optional values as unset', () => {
    expect(parseConfig({ DATABASE_URL: '   ' }).DATABASE_URL).toBeUndefined();
  });
});
