/** What the remote / keyboard asks for, whatever the platform (see input.js for the key codes). */
export const Action = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  ENTER: 'enter',
  LONG_ENTER: 'longEnter', // OK held down (only where the focused element has a long-press action)
  BACK: 'back',
  PLAY: 'play',
  PAUSE: 'pause',
  PLAY_PAUSE: 'playPause',
  STOP: 'stop',
  FAST_FORWARD: 'fastForward',
  REWIND: 'rewind',
  CHANNEL_UP: 'channelUp',
  CHANNEL_DOWN: 'channelDown',
});
