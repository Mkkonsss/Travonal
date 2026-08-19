const React = require('react');

function VideoView() { return null; }

function useVideoPlayer(source, setup) {
  const player = {
    play: jest.fn(),
    pause: jest.fn(),
    loop: false,
  };
  if (setup) setup(player);
  return player;
}

module.exports = { VideoView, useVideoPlayer };
