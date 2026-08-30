/**
 * Top-right view controls: frame snap (restore animation view) and lock
 * (hold current framing against pan/zoom).
 */
(function viewSnapModule() {
  const ICON_FRAME = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2zm2 10H3v4a2 2 0 0 0 2 2h4v-2H5v-4zm14 4h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5a2 2 0 0 0-2-2z"/>
    </svg>
  `;
  const ICON_LOCKED = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm7 12H7v-8h10v8Zm-5-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
    </svg>
  `;
  const ICON_UNLOCKED = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-7.87-1 1 1 0 0 0 1.74 1A2 2 0 0 1 14 7v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm0 10H7v-8h10v8Zm-5-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
    </svg>
  `;

  class ViewSnapLock {
    constructor(host, options = {}) {
      this.isLocked = typeof options.isLocked === "function"
        ? options.isLocked
        : () => Boolean(this._locked);
      this.onLock = options.onLock || (() => {});
      this.onUnlock = options.onUnlock || (() => {});
      this.onSnap = options.onSnap || (() => {});
      this._locked = false;

      this.root = document.createElement("div");
      this.root.className = "view-snap-controls";

      this.frameBtn = document.createElement("button");
      this.frameBtn.type = "button";
      this.frameBtn.className = "view-frame-snap";
      this.frameBtn.setAttribute("aria-label", "Snap to animation view");
      this.frameBtn.title = "Snap to animation view";
      this.frameBtn.innerHTML = ICON_FRAME;

      this.lockBtn = document.createElement("button");
      this.lockBtn.type = "button";
      this.lockBtn.className = "view-snap-lock";
      this.lockBtn.setAttribute("aria-pressed", "false");

      this.root.append(this.frameBtn, this.lockBtn);
      host.appendChild(this.root);

      this.frameBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onSnap();
      });
      this.frameBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
      this.frameBtn.addEventListener("mousedown", (event) => event.stopPropagation());

      this.lockBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.isLocked()) this.onUnlock();
        else this.onLock();
        this.sync();
      });
      this.lockBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
      this.lockBtn.addEventListener("mousedown", (event) => event.stopPropagation());

      this.sync();
    }

    sync() {
      const locked = Boolean(this.isLocked());
      this._locked = locked;
      this.lockBtn.classList.toggle("is-locked", locked);
      this.lockBtn.setAttribute("aria-pressed", locked ? "true" : "false");
      this.lockBtn.setAttribute(
        "aria-label",
        locked
          ? "Unlock view — allow pan and zoom"
          : "Lock view — prevent pan and zoom",
      );
      this.lockBtn.title = locked
        ? "Unlock view (allow pan and zoom)"
        : "Lock view (prevent pan and zoom)";
      this.lockBtn.innerHTML = locked ? ICON_LOCKED : ICON_UNLOCKED;
    }
  }

  window.ViewSnapLock = {
    mount(host, options) {
      if (!host) return null;
      return new ViewSnapLock(host, options || {});
    },
  };
})();
