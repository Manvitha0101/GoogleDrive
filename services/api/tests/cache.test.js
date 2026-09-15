'use strict';

const { getCache, setCache, invalidateCache, getFolderCacheKey } = require('../src/lib/cache');

describe('Redis & Memory Caching Layer Tests', () => {
  const testKey = 'test:cache:sample-key';
  const testData = { files: [{ id: '1', name: 'report.pdf' }], total: 1 };

  test('sets and gets cache value properly', async () => {
    await setCache(testKey, testData, 10);
    const cached = await getCache(testKey);
    expect(cached).toEqual(testData);
  });

  test('invalidates cache by key prefix properly', async () => {
    await setCache('test:cache:item-1', { a: 1 }, 10);
    await setCache('test:cache:item-2', { b: 2 }, 10);

    await invalidateCache('test:cache');

    const item1 = await getCache('test:cache:item-1');
    const item2 = await getCache('test:cache:item-2');

    expect(item1).toBeNull();
    expect(item2).toBeNull();
  });

  test('generates expected cache keys', () => {
    const key = getFolderCacheKey('user-123', 'folder-456');
    expect(key).toBe('cache:folders:user-123:folder-456');

    const rootKey = getFolderCacheKey('user-123', null);
    expect(rootKey).toBe('cache:folders:user-123:root');
  });
});
