import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
HTMLElement.prototype.scrollIntoView = vi.fn();
// jsdom has no pseudo-element layout, used by Ant Design's scrollbar measurement.
const getComputedStyle = window.getComputedStyle;
window.getComputedStyle = (element) => getComputedStyle(element);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
