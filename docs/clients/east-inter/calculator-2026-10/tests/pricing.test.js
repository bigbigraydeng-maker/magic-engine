'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../pricing-rates.js');
const {createEngine,resolveRates,toAud} = require('../pricing-engine.js');
const {old,pdfAud} = require('./fixtures/september-2026.js');
const E = createEngine(config);
const est = args => E.estimate({quantity:1,...args});

test('conversion rule: ceil(RMB / 4.9) reproduces every AUD figure of the September 2026 rate guide', () => {
  const R = resolveRates(old);
  for (const [city,[first,large,next]] of Object.entries(pdfAud.lcl)) {
    assert.deepEqual([R.lcl[city].first,R.lcl[city].large,R.lcl[city].next],[first,large,next],city);
  }
  for (const [k,[first,next]] of Object.entries(pdfAud.airParcel)) assert.deepEqual([R.airParcel[k].first,R.airParcel[k].next],[first,next],k);
  for (const [k,[first,next,flat]] of Object.entries(pdfAud.seaParcel)) assert.deepEqual([R.seaParcel[k].first,R.seaParcel[k].next,R.seaParcel[k].flat],[first,next,flat],k);
  for (const [k,[ddu,ddp]] of Object.entries(pdfAud.bulk)) assert.deepEqual([R.bulk[k].DDU,R.bulk[k].DDP],[ddu,ddp],k);
  assert.equal(R.fees.fumigation,pdfAud.fumigation);
});

test('new quote vs old: only LCL sea freight changed; parcels, bulk-air unit prices and fees are identical (bulk-air billing unit corrected to 1kg)', () => {
  const o = resolveRates(old), n = resolveRates(config);
  assert.deepEqual(n.airParcel,o.airParcel);
  assert.deepEqual(n.seaParcel,o.seaParcel);
  assert.deepEqual({...n.bulk,unitKg:0},{...o.bulk,unitKg:0}); // per-unit prices identical
  assert.deepEqual([o.bulk.unitKg,n.bulk.unitKg],[0.5,1]); // only the billing unit was corrected
  assert.deepEqual(n.fees,o.fees);
  assert.notDeepEqual(n.lcl,o.lcl);
});

test('resolved AUD tables for the October 2026 quote (hand-converted: ceil(RMB/4.9))', () => {
  const R = E.rates;
  assert.deepEqual([R.lcl.sydney.first,R.lcl.sydney.large,R.lcl.sydney.next],[378,317,215]); // 1850,1550,1050
  assert.deepEqual([R.lcl.perth.first,R.lcl.perth.large,R.lcl.perth.next],[337,327,225]);    // 1650,1600,1100
  assert.deepEqual([R.lcl.adelaide.first,R.lcl.adelaide.large,R.lcl.adelaide.next],[419,409,266]); // 2050,2000,1300
  assert.equal(toAud(1850,4.9),378);
  assert.equal(toAud(4.9*100,4.9),100); // exact multiple does not round up
});

// ---- LCL sea freight (RMB 1850/1050 first/next, 1550 at 10 CBM+; AUD 378/215/317)
test('LCL Sydney 1 CBM (minimum): first CBM only', () => assert.equal(est({service:'lcl',city:'sydney',quantity:1}).total,378));
test('LCL Sydney 5 CBM: 378 + 4*215', () => assert.equal(est({service:'lcl',city:'sydney',quantity:5}).total,1238));
test('LCL Sydney 9.99 CBM stays on the under-10 first-CBM rate: 378 + 8.99*215', () => {
  assert.ok(Math.abs(est({service:'lcl',city:'sydney',quantity:9.99}).total - 2310.85) < 1e-9);
});
test('LCL Sydney 10 CBM switches to the 10+ first-CBM rate: 317 + 9*215', () => assert.equal(est({service:'lcl',city:'sydney',quantity:10}).total,2252));
test('LCL Melbourne 25 CBM: 317 + 24*215', () => assert.equal(est({service:'lcl',city:'melbourne',quantity:25}).total,5477));
test('LCL below 1 CBM is refused', () => assert.match(est({service:'lcl',city:'sydney',quantity:0.5}).error,/start at 1/));
test('LCL Brisbane 3 CBM has no extra fee: 378 + 2*215', () => assert.equal(est({service:'lcl',city:'brisbane',quantity:3}).total,808));
test('LCL Gold Coast 2 CBM: 378 + 215 + minimum surcharge 275', () => assert.equal(est({service:'lcl',city:'goldCoast',quantity:2}).total,868));
test('LCL Gold Coast 6 CBM: surcharge 6*55=330 beats the 275 minimum', () => assert.equal(est({service:'lcl',city:'goldCoast',quantity:6}).total,1783));
test('LCL Perth 3 CBM door delivery: 337 + 2*225 + max(165,165)', () => assert.equal(est({service:'lcl',city:'perth',quantity:3,delivery:'door'}).total,952));
test('LCL Perth 3 CBM warehouse collection: no delivery fee', () => assert.equal(est({service:'lcl',city:'perth',quantity:3,delivery:'collection'}).total,787));
test('LCL Perth 12 CBM door: 327 + 11*225 + 12*55', () => assert.equal(est({service:'lcl',city:'perth',quantity:12,delivery:'door'}).total,3462));
test('LCL Adelaide 3 CBM door: 419 + 2*266 + minimum 135 (3*35=105 is below it)', () => assert.equal(est({service:'lcl',city:'adelaide',quantity:3,delivery:'door'}).total,1086));
test('LCL Adelaide 4 CBM door: 419 + 3*266 + 4*35=140 (above the 135 minimum)', () => assert.equal(est({service:'lcl',city:'adelaide',quantity:4,delivery:'door'}).total,1357));
test('LCL Adelaide 10 CBM collection: 409 + 9*266', () => assert.equal(est({service:'lcl',city:'adelaide',quantity:10,delivery:'collection'}).total,2803));
test('LCL note keeps the fumigation / broker wording with converted fumigation A$143', () => {
  const w = est({service:'lcl',city:'sydney',quantity:2}).warning;
  assert.match(w,/A\$143 per shipment/); assert.match(w,/A\$99; A\$201 if cargo value exceeds A\$10,000/);
});

// ---- Air parcel (RMB 70/26 general, 87/33 sensitive per 0.5kg; AUD 15/6, 18/7)
test('Air parcel general 0.5kg: first 0.5kg only', () => assert.equal(est({service:'airParcel',city:'sydney',quantity:0.5}).total,15));
test('Air parcel general 0.51kg rounds up to 2 units: 15 + 6', () => assert.equal(est({service:'airParcel',city:'sydney',quantity:0.51}).total,21));
test('Air parcel general 2kg: 15 + 3*6', () => assert.equal(est({service:'airParcel',city:'sydney',quantity:2}).total,33));
test('Air parcel sensitive 1.2kg: 3 units, 18 + 2*7', () => assert.equal(est({service:'airParcel',city:'sydney',quantity:1.2,cargo:'sensitive'}).total,32));
test('Air parcel 10kg is priced but carries the eligibility warning: 15 + 19*6', () => {
  const q = est({service:'airParcel',city:'sydney',quantity:10}); assert.equal(q.total,129); assert.match(q.warning,/under approximately 10kg/);
});

// ---- Sea parcel (RMB 80/10/11 Sydney+Melbourne; 105/30/24 others; AUD 17/3/3 and 22/7/5)
test('Sea parcel Sydney 1kg: 17', () => assert.equal(est({service:'seaParcel',city:'sydney',quantity:1}).total,17));
test('Sea parcel Sydney 5kg: 17 + 4*3', () => assert.equal(est({service:'seaParcel',city:'sydney',quantity:5}).total,29));
test('Sea parcel Sydney 19kg is below the flat tier: 17 + 18*3', () => assert.equal(est({service:'seaParcel',city:'sydney',quantity:19}).total,71));
test('Sea parcel Sydney 19.01kg rounds to 20kg and takes the flat rate: 20*3', () => assert.equal(est({service:'seaParcel',city:'sydney',quantity:19.01}).total,60));
test('Sea parcel Brisbane 3kg: 22 + 2*7', () => assert.equal(est({service:'seaParcel',city:'brisbane',quantity:3}).total,36));
test('Sea parcel Perth 25kg flat: 25*5', () => assert.equal(est({service:'seaParcel',city:'perth',quantity:25}).total,125));

// ---- Bulk air (price per 1kg, confirmed by East Inter via the PM 2026-10-10; AUD DDU/DDP per kg)
test('Bulk air Sydney DDP 10kg (lower bound): 10 kg * 11', () => assert.equal(est({service:'bulkAir',city:'sydney',quantity:10,tax:'DDP'}).total,110));
test('Bulk air Sydney DDP 50kg: 50 * 11', () => assert.equal(est({service:'bulkAir',city:'sydney',quantity:50,tax:'DDP'}).total,550));
test('Bulk air Sydney DDU 50kg (tax excluded): 50 * 10', () => assert.equal(est({service:'bulkAir',city:'sydney',quantity:50,tax:'DDU'}).total,500));
test('Bulk air Perth DDP 99kg (upper bound): 99 * 12', () => assert.equal(est({service:'bulkAir',city:'perth',quantity:99,tax:'DDP'}).total,1188));
test('Bulk air other cities DDU 12.3kg rounds up to 13kg: 13 * 12', () => assert.equal(est({service:'bulkAir',city:'other',quantity:12.3,tax:'DDU'}).total,156));
test('Bulk air uses the greater of actual and volume weight: 10kg actual, 0.1 m³ = 16.67kg, 17kg * 11', () => {
  assert.equal(est({service:'bulkAir',city:'sydney',quantity:10,tax:'DDP',volume:0.1}).total,187);
});
test('Bulk air refuses under 10kg and over 99kg', () => {
  assert.match(est({service:'bulkAir',city:'sydney',quantity:9.99}).error,/10–99kg/);
  assert.match(est({service:'bulkAir',city:'sydney',quantity:100}).error,/10–99kg/);
});

test('LCL over 500kg/CBM is charged at weight: Sydney 1 m3 1000kg = 2 CBM', () => {
  const heavy = est({service:'lcl',city:'sydney',quantity:1,weightKg:1000}), light = est({service:'lcl',city:'sydney',quantity:1,weightKg:100});
  assert.ok(heavy.total > light.total);
  assert.equal(light.total, est({service:'lcl',city:'sydney',quantity:1}).total);
});
test('Bulk air DDU warns the A$110 clearance fee is excluded', () => assert.match(est({service:'bulkAir',city:'sydney',quantity:50,tax:'DDU'}).warning,/A\$110/));
