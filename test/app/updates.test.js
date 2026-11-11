import { restartDialog } from '../../src/app/updates.js';

test('the update dialog: "Restart now" reloads, "Stay" shows the usual notice; it waits for another dialog to close', async () => {
  jest.useFakeTimers();
  const reload = jest.fn();
  const location = window.location;
  delete window.location;
  window.location = { reload };
  let busy = true;
  const notices = { show: jest.fn() };
  const dialogs = { confirm: jest.fn(async () => true) };
  const asking = restartDialog({ dialogs, notices, isBusy: () => busy })('2.0.1');
  await Promise.resolve();
  expect(dialogs.confirm).not.toHaveBeenCalled(); // another dialog is open
  busy = false;
  await jest.advanceTimersByTimeAsync(2100);
  await asking;
  expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: expect.any(String), cancelLabel: expect.any(String) }));
  expect(reload).toHaveBeenCalled();
  dialogs.confirm = jest.fn(async () => false);
  await restartDialog({ dialogs, notices, isBusy: () => false })('2.0.1');
  expect(notices.show).toHaveBeenCalledWith(expect.objectContaining({ key: 'update' }));
  window.location = location;
  jest.useRealTimers();
});
