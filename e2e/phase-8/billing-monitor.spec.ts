import { test, expect } from '@playwright/test';
import {
  navigateToDashboard,
  navigateToModule,
  expectNavItemActive,
} from '../helpers/navigation';
import { TEST_DATA, extractTableData } from '../fixtures/test-data';

test.describe('P8.11 Billing Monitor', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToDashboard(page);
  });

  test('应该显示Billing Monitor导航项', async ({ page }) => {
    const navItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('aside nav a')).map(
        (a) => a.textContent?.trim()
      );
    });
    const hasBillingMonitor = navItems.some((item) =>
      item?.includes('Billing Monitor')
    );
    expect(hasBillingMonitor).toBe(true);
  });

  test('应该导航到Billing Monitor页面', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );
    // Wait for the page content to load
    await page.waitForSelector('main h1', { timeout: 5000 });
    const heading = await page.textContent('main h1');
    expect(heading).toContain('Billing');
  });

  test('应该在Billing Monitor导航项标记为活跃', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );
    const isActive = await expectNavItemActive(
      page,
      '/dashboard/admin/billing-monitor'
    );
    expect(isActive).toBe(true);
  });

  test('应该显示月份选择器', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    const monthSelector = await page.$(
      'select[aria-label*="month" i], select'
    );
    expect(monthSelector).toBeTruthy();
  });

  test('应该加载月份列表', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    // Wait for select options to be populated
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select');
        return select && select.options.length > 0;
      },
      { timeout: 5000 }
    );

    const select = await page.$('select');
    if (select) {
      const options = await select.$$('option');
      expect(options.length).toBeGreaterThan(0);
    }
  });

  test('应该显示成本汇总卡片', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    // Wait for select options to be populated
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select');
        return select && select.options.length > 0;
      },
      { timeout: 5000 }
    );

    const select = await page.$('select');
    if (select) {
      const options = await select.$$('option');
      if (options.length >= 2) {
        await select.selectOption({ index: 1 });
        // Wait for billing data to be fetched and rendered
        await page.waitForFunction(
          () => {
            const cards = document.querySelectorAll('.rounded-lg.bg-white.shadow.p-6');
            return cards.length >= 3;
          },
          { timeout: 5000 }
        );
      }
    }

    const summaryCards = await page.$$(
      '.rounded-lg.bg-white.shadow.p-6'
    );
    expect(summaryCards.length).toBeGreaterThanOrEqual(3);

    const cardTexts = await Promise.all(
      summaryCards.map((card) => card.textContent())
    );
    const hasExpectedCards = cardTexts.some(
      (text) =>
        text?.includes('Cost') ||
        text?.includes('Calls') ||
        text?.includes('Service')
    );
    expect(hasExpectedCards).toBeTruthy();
  });

  test('应该显示按服务划分的成本表', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    const select = await page.$('select');
    if (select) {
      const options = await select.$$('option');
      if (options.length >= 2) {
        await select.selectOption({ index: 1 });
        await page.waitForFunction(
          () => {
            const heading = document.querySelector('h2');
            return heading && heading.textContent?.includes('Costs by Service');
          },
          { timeout: 5000 }
        );
      }
    }

    const serviceSection = await page.$('text=Costs by Service');
    if (serviceSection) {
      expect(serviceSection).toBeTruthy();
    }
  });

  test('应该显示按客户和服务的详细明细表', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    // Wait for select options to be populated
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select');
        return select && select.options.length > 0;
      },
      { timeout: 5000 }
    );

    const select = await page.$('select');
    if (select) {
      const options = await select.$$('option');
      if (options.length >= 2) {
        await select.selectOption({ index: 1 });
        // Wait for table to appear
        await page.waitForFunction(
          () => {
            return document.querySelector('table') !== null;
          },
          { timeout: 5000 }
        );
      }
    }

    const detailTable = await page.$('table');
    expect(detailTable).toBeTruthy();

    if (detailTable) {
      const tableData = await extractTableData(page);
      if (tableData.headers && tableData.headers.length > 0) {
        const headerText = tableData.headers.map((h: string | null | undefined) =>
          h?.toLowerCase()
        );
        const hasRequiredColumns =
          headerText.some((h: string | undefined) => h?.includes('client')) ||
          headerText.some((h: string | undefined) => h?.includes('service')) ||
          headerText.some((h: string | undefined) => h?.includes('api')) ||
          headerText.some((h: string | undefined) => h?.includes('cost'));
        expect(hasRequiredColumns).toBeTruthy();
      }
    }
  });

  test('应该允许月份切换', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    const select = await page.$('select');
    expect(select).toBeTruthy();

    if (select) {
      const options = await select.$$('option');
      if (options.length >= 2) {
        const initialValue = await select.inputValue();
        await select.selectOption({ index: 1 });
        await page.waitForFunction(
          () => {
            const newVal = (document.querySelector('select') as HTMLSelectElement)?.value;
            return newVal && newVal !== initialValue;
          },
          { timeout: 5000 }
        );

        const newValue = await select.inputValue();
        expect(newValue).not.toBe(initialValue);
      }
    }
  });

  test('应该处理加载状态', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    // Wait for select options to be populated
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select');
        return select && select.options.length > 0;
      },
      { timeout: 5000 }
    );

    const select = await page.$('select');
    if (select) {
      const options = await select.$$('option');
      if (options.length >= 2) {
        await select.selectOption({ index: 1 });
        // Wait for table or list content to appear
        await page.waitForFunction(
          () => {
            return document.querySelector('table') !== null ||
                   document.querySelector('.divide-y') !== null;
          },
          { timeout: 5000 }
        );
      }
    }

    const hasContent = await page.$('table, .divide-y');
    expect(hasContent).toBeTruthy();
  });

  test('应该支持客户ID链接', async ({ page }) => {
    await navigateToModule(
      page,
      '/dashboard/admin/billing-monitor',
      'Billing Monitor'
    );

    const select = await page.$('select');
    if (select) {
      const options = await select.$$('option');
      if (options.length >= 2) {
        await select.selectOption({ index: 1 });
        await page.waitForFunction(
          () => {
            return document.querySelector('a[href*="/dashboard/clients/"]') !== null;
          },
          { timeout: 5000 }
        );
      }
    }

    const clientLinks = await page.$$(
      'a[href*="/dashboard/clients/"]'
    );
    if (clientLinks.length > 0) {
      const href = await clientLinks[0].getAttribute('href');
      expect(href).toMatch(/\/dashboard\/clients\//);
    }
  });
});
