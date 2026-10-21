/**
 * Videos in a light and a dark version: `figure[data-video]` with one <video> per theme
 * (SiteVideo.astro). Switching the theme while a video plays hands playback over to the
 * other version at the same second.
 */
type PostHog = { capture: (event: string, properties?: Record<string, unknown>) => void };

for (const figure of document.querySelectorAll<HTMLElement>('figure[data-video]')) {
  const videos = [...figure.querySelectorAll('video')];

  // Hand a started video over to the version for the new theme.
  const sync = () => {
    const target = videos.find((video) => video.checkVisibility());
    for (const video of videos) {
      if (video === target || (video.paused && video.currentTime === 0)) continue;
      const playing = !video.paused;
      video.pause();
      if (!target) continue;
      target.currentTime = video.currentTime;
      target.muted = video.muted;
      target.volume = video.volume;
      const from = video.textTracks[0];
      const to = target.textTracks[0];
      if (from && to) to.mode = from.mode;
      if (playing) target.play().catch(() => {});
    }
  };
  document.addEventListener('themechange', sync);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);

  // One video_played event per video per page view, sent only when PostHog is loaded (Analytics.astro).
  let tracked = false;
  for (const video of videos) {
    video.addEventListener('play', () => {
      if (tracked) return;
      tracked = true;
      const posthog = (window as { posthog?: PostHog }).posthog;
      posthog?.capture('video_played', { video: figure.dataset.video, theme: video.dataset.themeImage });
    });
  }
}
