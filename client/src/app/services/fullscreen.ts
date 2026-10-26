import { Service, signal } from '@angular/core';

// Wraps the browser Fullscreen API so players can hide tabs/address bar/
// notifications while playing. Chrome (desktop and Android) supports the
// unprefixed standard API used here.
@Service()
export class Fullscreen {
  readonly isSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  readonly isActive = signal(!!document?.fullscreenElement);

  // iOS Safari (and every other iOS browser, since Apple requires them all to
  // use WebKit) has no Fullscreen API at all. "Add to Home Screen" launching
  // in standalone mode is the only chrome-less option there, but it can't be
  // triggered by JS - only shown as a tip for the user to do manually.
  readonly isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  readonly isStandalone =
    typeof navigator !== 'undefined' &&
    ((navigator as unknown as { standalone?: boolean }).standalone === true ||
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches));

  constructor() {
    document.addEventListener('fullscreenchange', () => {
      this.isActive.set(!!document.fullscreenElement);
    });
  }

  async toggle() {
    if (!this.isSupported) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browsers reject this outside a direct user gesture or if denied;
      // isActive just stays whatever it already was.
    }
  }

  // Request-only, idempotent version of toggle(): used to auto-enter
  // fullscreen right as a player lands in a room. Must be called from
  // (close to) the same click handler that caused the navigation - the
  // Fullscreen API silently rejects calls that aren't tied to a fresh user
  // gesture, so this can't be triggered reactively from a route/state change.
  async enter() {
    if (!this.isSupported || document.fullscreenElement) return;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // No user gesture in this browser's eyes, or the user denied it before -
      // never block gameplay over it.
    }
  }
}
