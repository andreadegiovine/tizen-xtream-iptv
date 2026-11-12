const mockUpdates = { check: jest.fn(), install: jest.fn(async () => undefined) };
jest.mock('../../src/services/updates.js', () => ({
  checkForUpdate: (...args) => mockUpdates.check(...args),
  installUpdate: (...args) => mockUpdates.install(...args),
  runningVersions: () => ({ bundle: '2.0.0', shell: '2.0.0' }),
}));

describe('checkUpdates (Settings › Advanced › Check for updates)', () => {
  beforeEach(() => {
    global.__AUTOUPDATE__ = true;
    global.__UPDATE_CHANNEL__ = 'tizen';
    mockUpdates.check.mockReset();
    mockUpdates.install.mockClear();
  });
  afterEach(() => {
    delete global.__AUTOUPDATE__;
    delete global.__UPDATE_CHANNEL__;
  });

  test('nothing newer: "latest"; a version that needs a new package: its notice', async () => {
    const { checkUpdates } = await import('../../src/app/updates.js');
    const notices = { show: jest.fn() };
    mockUpdates.check.mockResolvedValue(null);
    expect(await checkUpdates({ notices })).toBe('latest');
    mockUpdates.check.mockResolvedValue({ version: '3.0.0', needsPackage: true });
    expect(await checkUpdates({ notices })).toBe('package');
    expect(notices.show).toHaveBeenCalledWith(expect.objectContaining({ key: 'update', permanent: true }));
    expect(mockUpdates.install).not.toHaveBeenCalled();
  });

  test('a newer build: downloaded, then the restart dialog; a failure: "failed"', async () => {
    const { checkUpdates } = await import('../../src/app/updates.js');
    const notices = { show: jest.fn() };
    const askRestart = jest.fn(async () => undefined);
    mockUpdates.check.mockResolvedValue({ version: '2.0.1' });
    expect(await checkUpdates({ notices, askRestart })).toBe('ready');
    expect(mockUpdates.install).toHaveBeenCalled();
    expect(askRestart).toHaveBeenCalledWith('2.0.1');
    mockUpdates.check.mockRejectedValue(new Error('offline'));
    expect(await checkUpdates({ notices, askRestart })).toBe('failed');
  });

  test('a package that does not update itself: "off", nothing asked', async () => {
    delete global.__AUTOUPDATE__;
    const { checkUpdates, canUpdateItself } = await import('../../src/app/updates.js');
    expect(canUpdateItself()).toBe(false);
    expect(await checkUpdates({ notices: { show: jest.fn() } })).toBe('off');
    expect(mockUpdates.check).not.toHaveBeenCalled();
  });
});
