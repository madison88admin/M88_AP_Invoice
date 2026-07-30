import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapNextGenMPOLine, nextGenService } from './nextGenService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mapNextGenMPOLine', () => {
  it('maps the confirmed live NextGen MPO-line field names', () => {
    const line = mapNextGenMPOLine({
      Id: 50748,
      OrderId: 18544,
      LineItem: 1,
      CommodityId: 17873,
      CommodityName: 'HH AIR ZERMATT WOVEN CLIP LABEL ',
      CommodityDescription: 'Woven Tab Label',
      CommodityExternalReference: 'ZVT000123',
      Quantity: 1050,
      SellingLineQuantityTotal: 1050,
      LinePurchasePrice: 52.5,
      PurchasePrice: 0.05,
      PurchaseUnitOfMeasureName: 'pc',
      SellingUnitOfMeasureName: 'pc',
    });

    expect(line).toMatchObject({
      order_id: 18544,
      line_id: 50748,
      line_reference: '1',
      material_id: 17873,
      item_code: 'ZVT000123',
      material_name: 'HH AIR ZERMATT WOVEN CLIP LABEL',
      description: 'Woven Tab Label',
      quantity: 1050,
      selling_quantity: 1050,
      unit_price: 0.05,
      total_amount: 52.5,
      purchase_uom: 'pc',
    });
    expect(line.material_url).toBe('https://nextgen.madison88.com/Material/Edit/17873');
  });

  it('derives unit price from the line total when PurchasePrice is unavailable', () => {
    const line = mapNextGenMPOLine({ Quantity: 1050, LinePurchasePrice: 52.5 });
    expect(line.unit_price).toBe(0.05);
    expect(line.total_amount).toBe(52.5);
  });

  it('falls back to MPOLIGridRead when FormLinesGridRead is unavailable', async () => {
    const service = nextGenService as any;
    service.useMock = false;
    const postForm = vi.spyOn(service, 'postForm')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        Data: [{
          OrderId: 18544,
          LineItem: 1,
          CommodityExternalReference: 'ZVT000123',
          Quantity: 1050,
          PurchasePrice: 0.05,
          LinePurchasePrice: 52.5,
        }],
      });

    const result = await service.fetchMPOLinesWithStatus(18544);

    expect(postForm.mock.calls.map(call => call[0])).toEqual([
      '/MaterialPurchaseOrder/FormLinesGridRead',
      '/MaterialPurchaseOrder/MPOLIGridRead',
    ]);
    expect(result).toMatchObject({
      available: true,
      source: 'MPOLIGridRead',
      lines: [{ order_id: 18544, item_code: 'ZVT000123', quantity: 1050, unit_price: 0.05, total_amount: 52.5 }],
    });
  });

  it('marks line data unavailable when both NextGen line endpoints fail', async () => {
    const service = nextGenService as any;
    service.useMock = false;
    vi.spyOn(service, 'postForm').mockResolvedValue(null);

    await expect(service.fetchMPOLinesWithStatus(18544)).resolves.toEqual({
      lines: [],
      available: false,
    });
  });

  it('forces a fresh login and retries a form request once after HTTP 500', async () => {
    const service = nextGenService as any;
    service.useMock = false;
    service.sessionCookie = 'stale-cookie';
    service.cookieObtainedAt = Date.now();
    const login = vi.spyOn(service, 'login').mockImplementation(async () => {
      service.sessionCookie = 'fresh-cookie';
      service.cookieObtainedAt = Date.now();
      return true;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Data: [{ OrderId: 18544 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.postForm(
      '/MaterialPurchaseOrder/FormLinesGridRead',
      new URLSearchParams({ OrderId: '18544' })
    );

    expect(login).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('fresh-cookie');
    expect(result).toEqual({ Data: [{ OrderId: 18544 }] });
  });

  it('blocks non-allowlisted and lookalike NextGen write paths', () => {
    const service = nextGenService as any;
    expect(() => service.assertReadOnly('/MaterialPurchaseOrder/EditSave')).toThrow(/READ-ONLY/);
    expect(() => service.assertReadOnly('/MaterialPurchaseOrder/Delete')).toThrow(/READ-ONLY/);
    expect(() => service.assertReadOnly('/MaterialPurchaseOrder/GetById?id=18544')).not.toThrow();
  });
});
