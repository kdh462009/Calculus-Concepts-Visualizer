/**
 * Top-right lock control: snap the plot to the animation’s proper view and
 * hold it there, or unlock while keeping the current framing until the user pans.
 */
(function viewSnapModule() {
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
      this._locked = false;

      this.root = document.createElement("button");
      this.root.type = "button";
      this.root.className = "view-snap-lock";
      this.root.setAttribute("aria-pressed", "false");
      host.appendChild(this.root);
      this.root.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.isLocked()) this.onUnlock();
        else this.onLock();
        this.sync();
      });
      this.root.addEventListener("pointerdown", (event) => event.stopPropagation());
      this.root.addEventListener("mousedown", (event) => event.stopPropagation());
      this.sync();
    }

    sync() {
      const locked = Boolean(this.isLocked());
      this._locked = locked;
      this.root.classList.toggle("is-locked", locked);
      this.root.setAttribute("aria-pressed", locked ? "true" : "false");
      this.root.setAttribute(
        "aria-label",
        locked
          ? "Unlock view — keeps current framing until you pan or zoom"
          : "Snap to animation view and lock framing",
      );
      this.root.title = locked
        ? "Unlock view (stays centered until you move)"
        : "Snap & lock to animation view";
      this.root.innerHTML = locked ? ICON_LOCKED : ICON_UNLOCKED;
    }
  }

  window.ViewSnapLock = {
    mount(host, options) {
      if (!host) return null;
      return new ViewSnapLock(host, options || {});
    },
  };
})();
