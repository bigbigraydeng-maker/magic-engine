// Previous (2026-09-20) quote, RMB, from the old 2026年东际澳洲报价.xls, and the AUD figures published in
// "East Inter Freight Rates.pdf" (September 2026). Used only to prove the conversion rule and to compute the old-vs-new diff.
const current = require('../../pricing-rates.js');
const clone = o => JSON.parse(JSON.stringify(o));
const old = clone(current);
old.effective = 'September 2026';
Object.assign(old.lcl.sydney,{firstRmb:1900,largeRmb:1600,nextRmb:1100});
Object.assign(old.lcl.melbourne,{firstRmb:1900,largeRmb:1600,nextRmb:1100});
Object.assign(old.lcl.brisbane,{firstRmb:1900,largeRmb:1600,nextRmb:1100});
Object.assign(old.lcl.goldCoast,{firstRmb:1900,largeRmb:1600,nextRmb:1100});
Object.assign(old.lcl.sunshineCoast,{firstRmb:1900,largeRmb:1600,nextRmb:1100});
Object.assign(old.lcl.perth,{firstRmb:1700,largeRmb:1650,nextRmb:1200});
Object.assign(old.lcl.adelaide,{firstRmb:2150,largeRmb:2050,nextRmb:1400});
const pdfAud = {
  lcl:{sydney:[388,327,225],perth:[347,337,245],adelaide:[439,419,286]}, // [first, 10+ first, next]
  airParcel:{normal:[15,6],sensitive:[18,7]},
  seaParcel:{metro:[17,3,3],other:[22,7,5]}, // [first kg, extra kg, 20kg+ flat]
  bulk:{sydney:[10,11],brisbane:[11,12],perth:[11,12],other:[12,13]}, // [DDU, DDP]
  fumigation:143
};
module.exports = {old,pdfAud};
