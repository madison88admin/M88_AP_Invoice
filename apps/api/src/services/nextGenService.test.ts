import { describe, expect, it } from 'vitest';
import { mapNextGenMPOLine } from './nextGenService';

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
});
