/** Minimal Document Picture-in-Picture pop-out for floating panels.

 * Chromium / Edge 113+ only. isPopoutSupported() feature-detects it so panels
 * can auto-show a pop-out control only where it works. popoutElement() moves an
 * existing in-page floating panel DOM into an always-on-top PiP window, carries
 * Vite-injected styles + body font classes into that document, and wires Escape
 * / native-close back to the caller's close callback. Zero deps.
 */

export interface PopoutSession {
  /** Close the PiP window (idempotent). */
  closePip: () => void;
}

export interface PopoutOptions {
  width?: number;
  height?: number;
  /** Called when the PiP window closes (native close or Escape inside it). */
  onClose?: () => void;
}

export function isPopoutSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

export async function popoutElement(
  panel: HTMLElement,
  opts: PopoutOptions = {},
): Promise<PopoutSession> {
  const dpip = (window as unknown as {
    documentPictureInPicture?: {
      requestWindow(options: { width: number; height: number }): Promise<Window>;
    };
  }).documentPictureInPicture;
  if (!dpip) throw new Error("Document Picture-in-Picture is not supported");

  const pip = await dpip.requestWindow({
    width: opts.width ?? 360,
    height: opts.height ?? 560,
  });
  const pipDoc = pip.document;

  // Vite injects CSS as <style> in dev and <link rel=stylesheet> in build;
  // clone both so the panel keeps its look inside the PiP document.
  for (const el of Array.from(document.head.children)) {
    if (el.tagName === "STYLE" || el.tagName === "LINK") {
      pipDoc.head.appendChild(el.cloneNode(true));
    }
  }
  // Body-level font class (cyl-font-code / cyl-font-system) must follow too.
  pipDoc.body.className = document.body.className;

  // Move the existing panel node into the PiP window and anchor it to a corner.
  pipDoc.body.appendChild(panel);
  panel.style.position = "fixed";
  panel.style.top = "16px";
  panel.style.left = "16px";
  panel.style.right = "auto";
  panel.style.bottom = "auto";

  let closed = false;
  const closePip = (): void => {
    if (closed) return;
    closed = true;
    try {
      pip.close();
    } catch {
      /* ignore */
    }
  };

  // Escape inside the PiP window closes the panel (same behaviour as in-page).
  const onPipKey = (e: Event): void => {
    if ((e as KeyboardEvent).key === "Escape") {
      closePip();
      opts.onClose?.();
    }
  };
  pipDoc.addEventListener("keydown", onPipKey);

  // Native close of the PiP window closes the panel too (guard prevents
  // close() -> closePip() -> pagehide -> close() recursion).
  pip.addEventListener("pagehide", () => {
    if (closed) return;
    closed = true;
    opts.onClose?.();
  });

  return { closePip };
}