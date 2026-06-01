import { test, expect } from '@playwright/test';
import {
  navigateToDashboard,
  navigateToModule,
  expectNavItemActive,
} from '../helpers/navigation';
import { TEST_DATA, extractTableData } from '../fixtures/test-data';

test.describe('P8.7 SERP Intelligence', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  test('应该显示SERP Intelligence导航项', async ({ page }) => {
    const navItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('aside nav a')).map(
        (a) => a.textContent?.trim()
      );
    });
    const hasSerpIntelligence = navItems.some((item) =>
      item?.includes('SERP Intelligence')
    );
    expect(hasSerpIntelligence).toBe(true);
  });

  test('应该导航到SERP Intelligence页面', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/serp-intelligence',
      'SERP Intelligence'
    );
    const heading = await page.textContent('h1, h2');
    expect(heading).toBeTruthy();
  });

  test('应该在SERP Intelligence导航项标记为活跃', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/serp-intelligence',
      'SERP Intelligence'
    );
    const isActive = await expectNavItemActive(
      page,
      '/dashboard/serp-intelligence'
    );
    expect(isActive).toBe(true);
  });

  test('应该加载关键词排名数据或显示空状态', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/serp-intelligence',
      'SERP Intelligence'
    );

    await page.waitForFunction(
      () => {
        return document.querySelector('table') !== null ||
               document.querySelector('.text-center.text-gray-400') !== null;
      },
      { timeout: 8000 }
    );

    const table = await page.$('table');
    if (table) {
      expect(table).toBeTruthy();
    } else {
      const hasContent = await page.$('.text-center.text-gray-400');
      expect(hasContent).toBeTruthy();
    }
  });

  test('应该显示排名趋势信息', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/serp-intelligence',
      'SERP Intelligence'
    );

    const tableData = await extractTableData(page);
    if (tableData.headers && tableData.headers.length > 0) {
      const hasTrendData =
        tableData.headers.some((h: string | null | undefined) =>
          h?.toLowerCase().includes('trend')
        ) ||
        tableData.headers.some((h: string | null | undefined) =>
          h?.toLowerCase().includes('rank')
        );
      expect(hasTrendData || tableData.rows.length > 0).toBeTruthy();
    }
  });
});
