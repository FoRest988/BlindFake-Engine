import { test, expect, type Page } from '@playwright/test';

/**
 * Editor smoke test (F0 v0). Guards the invariant "the editor opens and every
 * tab can be visited without a page error" while the rework removes code.
 *
 * The WebGL-context counter documents the current state (several renderers)
 * and is tightened phase by phase (see docs/decisions/0000-rework-plan.md).
 */

const TEMPLATES = ['3d', '2d', 'platformer3d', 'fps', 'topdown2d', 'mainmenu', 'fighting', 'racing', 'puzzle'] as const;
const TABS = ['scene', 'terrain', 'animation', 'cinematic', 'statemachine', 'scripting', 'blueprints', 'ui', 'modeling', 'textures'] as const;
const MAX_WEBGL_CONTEXTS = 8;

declare global {
  interface Window {
    __bfTest: { webglContexts: number; contextLost: number };
  }
}

async function installContextCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { webglContexts: 0, contextLost: 0 };
    (window as Window).__bfTest = state;
    const seen = new WeakSet<HTMLCanvasElement>();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (original as (this: HTMLCanvasElement, t: string, ...a: unknown[]) => unknown).call(this, type, ...rest);
      if (ctx && (type === 'webgl' || type === 'webgl2') && !seen.has(this)) {
        seen.add(this);
        state.webglContexts++;
        this.addEventListener('webglcontextlost', () => { state.contextLost++; });
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function openProject(page: Page, template: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('[data-action="new"]');
  await page.fill('[data-input="project-name"]', `smoke-${template}`);
  await page.click(`.lp-template-card[data-template="${template}"]`);
  await page.click('[data-action="create-project"]');
  await expect(page.locator('#editor-root')).toBeVisible();
  await expect(page.locator('.editor-tabs .editor-tab').first()).toBeVisible();
}

for (const template of TEMPLATES) {
  test(`template "${template}": open editor, visit every tab, add cube, undo, play/stop`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await installContextCounter(page);
    await openProject(page, template);

    for (const tab of TABS) {
      await page.click(`.editor-tab[data-tab="${tab}"]`);
      await expect(page.locator(`.editor-tab[data-tab="${tab}"]`)).toHaveClass(/active/);
    }
    await page.click('.editor-tab[data-tab="scene"]');

    // Add → Cube, then undo it.
    await page.click('.menubar-item:has-text("Add")');
    await page.click('.menubar-dropdown-item:has-text("Cube")');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');

    // Play, then stop.
    await page.keyboard.press('F9');
    await page.waitForTimeout(500);
    await page.keyboard.press('F9');
    await page.waitForTimeout(250);

    const state = await page.evaluate(() => window.__bfTest);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(state.contextLost).toBe(0);
    expect(state.webglContexts).toBeLessThanOrEqual(MAX_WEBGL_CONTEXTS);
  });
}
